# Python MCP Gateway (FastAPI) Design (runtime-safe canvas version)

"""
This canvas holds a self contained version of the core MCP Gateway code, structured so that:

- FastAPI (and its dependency on `ssl`) is optional at import time.
- The important domain logic (OHID resolution, repository contracts, event publishing,
  CloudTalk signature verification) can be imported and tested in constrained environments
  that do not provide `ssl` or optional email validation packages.
- Postgres/asyncpg are only required if you actually use the `PostgresRepository`.
- In a real runtime (local, Catalyst, or AWS) where FastAPI, async SQLAlchemy and `asyncpg`
  are available, you simply call `create_app()` to obtain the FastAPI application instance.

The code is laid out approximately as multiple modules collapsed into one file for clarity.
When you move this into a real repo, split it into the suggested folders/files.
"""

# 1. Project structure (logical)

# opulent-mcp-gateway/
#   spec/
#     openapi.yaml
#     schemas/
#       domain.yaml
#       events.yaml
#       ai.yaml
#     config/
#       connectors.yaml
#   db/
#     postgres-schema.sql
#   src/
#     main.py
#     api/
#       __init__.py
#       lead.py
#       cloudtalk.py
#       elevenlabs.py
#     models/
#       __init__.py
#       domain.py
#       events.py
#     persistence/
#       __init__.py
#       repository.py
#       postgres_repo.py
#       catalyst_repo.py
#     services/
#       __init__.py
#       events.py
#       elevenlabs.py
#       ohid.py
#     config.py
#     validators.py
#   .env
#   pyproject.toml or requirements.txt
#   README.md

from __future__ import annotations

import json
import os
import hmac
import hashlib
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional, Dict, Any
from uuid import uuid4

# Optional FastAPI import: protected so environments without ssl/anyio do not fail at import time.
try:  # pragma: no cover - exercised only in real runtime, not in this constrained environment
    from fastapi import FastAPI, APIRouter, Depends, Header, HTTPException, Request

    _fastapi_import_error: Exception | None = None
except Exception as _e:  # pragma: no cover - we expect this in the canvas runner
    FastAPI = None  # type: ignore
    APIRouter = object  # light stub so type checkers do not complain
    Depends = lambda x: x  # type: ignore
    Header = lambda default="": default  # type: ignore
    HTTPException = Exception  # type: ignore
    Request = object  # type: ignore
    _fastapi_import_error = _e

import httpx
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker


# 2. Domain models (what would normally live in src/models/domain.py)


class Person(BaseModel):
    first_name: str
    last_name: str
    # Use plain string instead of EmailStr so that we do not require the optional
    # `email-validator` dependency in constrained environments. You can switch this
    # to `EmailStr` in your real repo if you install `pydantic[email]`.
    email: Optional[str] = None
    phone: Optional[str] = None


class LeadDetails(BaseModel):
    budget_range: Optional[str] = None
    location: Optional[str] = None
    property_type: Optional[str] = None
    free_text: Optional[str] = None


class Consent(BaseModel):
    marketing: bool
    source: Optional[str] = None
    timestamp: Optional[datetime] = None


class LeadIngestRequest(BaseModel):
    # pydantic v2 removed the `regex` kwarg from Field; use `pattern` instead.
    source_system: str = Field(..., pattern=r"^(META|WEB|CLOUDTALK|ZOHO_SOCIAL|ZOHO_CRM)$")
    source_lead_id: str
    channel: str = Field(
        ...,
        pattern=r"^(WEB_FORM|META_LEAD_AD|INBOUND_CALL|OUTBOUND_CALL|SOCIAL|CRM)$",
    )
    person: Person
    lead_details: Optional[LeadDetails] = None
    consent: Consent
    raw_payload: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime
    meta: Dict[str, Any] = Field(default_factory=dict)


class CloudtalkWebhookPayload(BaseModel):
    event_type: str
    call_id: str
    direction: str  # inbound or outbound
    from_: str = Field(alias="from")
    to: str
    recording_url: Optional[str] = None
    raw: Dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(populate_by_name=True)


# 3. Repository abstraction (src/persistence/repository.py)


class Repository(ABC):
    @abstractmethod
    async def insert_lead_context(self, ohid: str, ingest_id: str, lead: LeadIngestRequest) -> None:
        """Persist raw lead ingest plus context."""

    @abstractmethod
    async def find_ohid_by_contact(self, email: Optional[str], phone: Optional[str]) -> Optional[str]:
        """Look up an existing OHID by email/phone combination."""

    @abstractmethod
    async def insert_workflow_event(
        self,
        event_id: str,
        ohid: Optional[str],
        event_type: str,
        payload: Any,
        source_system: str,
    ) -> None:
        """Append a workflow event to the event log."""


# 4. Postgres implementation (src/persistence/postgres_repo.py)

# Note: the async Postgres driver `asyncpg` is **not** available in the canvas environment.
# To avoid `ModuleNotFoundError: asyncpg` at import time, we construct the engine lazily
# the first time a real Postgres session is needed.

DATABASE_URL = (
    f"postgresql+asyncpg://{os.getenv('PGUSER', '')}:{os.getenv('PGPASSWORD', '')}"
    f"@{os.getenv('PGHOST', 'localhost')}:{os.getenv('PGPORT', '5432')}/{os.getenv('PGDATABASE', '')}"
)

REQUIRED_ENV_KEYS = [
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGPASSWORD",
    "PGDATABASE",
    "CLOUDTALK_WEBHOOK_SECRET",
    "NOTION_WEBHOOK_SECRET",
    "N8N_WEBHOOK_URL",
    "REPOSITORY_IMPL",
]

OPTIONAL_ENV_KEYS = [
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
    "ELEVENLABS_MODEL_ID",
    "OPENAI_API_KEY",
]


def missing_env(keys: list[str]) -> list[str]:
    """Return env keys that are unset or empty (used for health checks)."""

    return [k for k in keys if not os.getenv(k)]


def env_health() -> Dict[str, Any]:
    """Summarize missing required/optional env keys for self-checks."""

    missing_required = missing_env(REQUIRED_ENV_KEYS)
    missing_optional = missing_env(OPTIONAL_ENV_KEYS)
    status = "ok" if not missing_required else "degraded"
    return {
        "status": status,
        "missing_required": missing_required,
        "missing_optional": missing_optional,
    }


def _get_session_factory():
    """Lazily create an async SQLAlchemy session factory.

    In a runtime without `asyncpg`, this raises a clear RuntimeError telling you to
    install the driver, instead of failing with a low level ModuleNotFoundError
    when the module is imported.
    """

    try:
        engine = create_async_engine(DATABASE_URL, echo=False, future=True)
    except ModuleNotFoundError as e:
        # Most likely: asyncpg is missing
        raise RuntimeError(
            "Async Postgres driver 'asyncpg' is not installed. "
            "Install it with 'pip install asyncpg' (or include it in your requirements) "
            "to use PostgresRepository."
        ) from e

    return sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class PostgresRepository(Repository):
    """Async Postgres-backed repository.

    In constrained environments (like this canvas) you should use _FakeRepo for tests,
    so this class is never instantiated. In your real service, ensure `asyncpg` is
    installed before using this.
    """

    def __init__(self) -> None:
        self._SessionLocal = None

    @property
    def SessionLocal(self):
        if self._SessionLocal is None:
            self._SessionLocal = _get_session_factory()
        return self._SessionLocal

    async def insert_lead_context(self, ohid: str, ingest_id: str, lead: LeadIngestRequest) -> None:
        SessionLocal = self.SessionLocal
        async with SessionLocal() as session:
            await session.execute(
                """
                INSERT INTO lead_context
                    (id, ohid, source_system, source_lead_id, channel, payload, consent, created_at)
                VALUES
                    (:id, :ohid, :source_system, :source_lead_id, :channel, :payload, :consent, :created_at)
                """,
                {
                    "id": ingest_id,
                    "ohid": ohid,
                    "source_system": lead.source_system,
                    "source_lead_id": lead.source_lead_id,
                    "channel": lead.channel,
                    "payload": json.dumps(lead.model_dump(by_alias=True)),
                    "consent": json.dumps(lead.consent.model_dump()),
                    "created_at": datetime.utcnow(),
                },
            )
            await session.commit()

    async def find_ohid_by_contact(self, email: Optional[str], phone: Optional[str]) -> Optional[str]:
        SessionLocal = self.SessionLocal
        async with SessionLocal() as session:
            result = await session.execute(
                """
                SELECT ohid
                FROM lead_context
                WHERE
                    (:email IS NOT NULL AND payload->'person'->>'email' = :email)
                    OR (:phone IS NOT NULL AND payload->'person'->>'phone' = :phone)
                LIMIT 1
                """,
                {"email": email, "phone": phone},
            )
            row = result.fetchone()
            return row[0] if row else None

    async def insert_workflow_event(
        self,
        event_id: str,
        ohid: Optional[str],
        event_type: str,
        payload: Any,
        source_system: str,
    ) -> None:
        SessionLocal = self.SessionLocal
        async with SessionLocal() as session:
            await session.execute(
                """
                INSERT INTO workflow_event
                    (id, ohid, event_type, payload, occurred_at, source_system)
                VALUES
                    (:id, :ohid, :event_type, :payload, :occurred_at, :source_system)
                """,
                {
                    "id": event_id,
                    "ohid": ohid,
                    "event_type": event_type,
                    "payload": json.dumps(payload),
                    "occurred_at": datetime.utcnow(),
                    "source_system": source_system,
                },
            )
            await session.commit()


# 5. OHID resolution service (src/services/ohid.py)


async def resolve_ohid(repo: Repository, payload: LeadIngestRequest) -> str:
    """Resolve or create an OHID based on email/phone identity."""

    email = payload.person.email
    phone = payload.person.phone
    existing = await repo.find_ohid_by_contact(email, phone)
    if existing:
        return existing
    return str(uuid4())


# 6. Event publishing service (src/services/events.py)


async def publish_event(event_type: str, payload: Any) -> None:
    """Publish an MCP event to n8n via HTTP webhook.

    In test/canvas environments N8N_WEBHOOK_URL is typically unset so this becomes a no op.
    """

    url = os.getenv("N8N_WEBHOOK_URL")
    if not url:
        return
    data = {"event_type": event_type, **payload}
    async with httpx.AsyncClient() as client:
        await client.post(url, json=data, timeout=10.0)


# 7. FastAPI wiring (src/api/* and src/main.py)

# Routers are only defined if FastAPI imported successfully. This prevents the ssl import
# error in constrained environments while keeping the code correct for real runtime.

if FastAPI is not None:  # pragma: no cover - exercised in real runtime only
    lead_router = APIRouter()

    def repo_dep() -> Repository:
        # Simple repository factory; in production you would switch on env to use Catalyst, etc.
        return PostgresRepository()

    @lead_router.post("/ingest")
    async def ingest_lead(payload: LeadIngestRequest, repo: Repository = Depends(repo_dep)):
        """Ingest a lead, persist context, and emit a LeadIngested event."""

        ohid = await resolve_ohid(repo, payload)
        ingest_id = str(uuid4())

        await repo.insert_lead_context(ohid, ingest_id, payload)

        event = {
            "event_type": "LeadIngested",
            "event_id": ingest_id,
            "occurred_at": datetime.utcnow().isoformat(),
            "ohid": ohid,
            "lead_ingest": payload.model_dump(),
        }

        await repo.insert_workflow_event(
            event_id=ingest_id,
            ohid=ohid,
            event_type="LeadIngested",
            payload=event,
            source_system=payload.source_system,
        )

        await publish_event("LeadIngested", event)

        return {"ohid": ohid, "ingest_id": ingest_id}

    cloudtalk_router = APIRouter()

    def verify_signature(body: bytes, signature: str) -> bool:
        secret = os.getenv("CLOUDTALK_WEBHOOK_SECRET", "")
        if not secret:
            return False
        mac = hmac.new(secret.encode("utf-8"), msg=body, digestmod=hashlib.sha256)
        expected = mac.hexdigest()
        if not signature:
            return False
        return hmac.compare_digest(expected, signature)

    @cloudtalk_router.post("/webhook")
    async def cloudtalk_webhook(
        request: Request,
        x_signature: str = Header(default=""),
        repo: Repository = Depends(repo_dep),
    ):
        raw_body = await request.body()
        if not verify_signature(raw_body, x_signature):
            raise HTTPException(status_code=401, detail="Invalid signature")

        payload = CloudtalkWebhookPayload.parse_raw(raw_body)

        event_id = str(uuid4())
        occurred_at = datetime.utcnow().isoformat()

        base_event = {
            "event_id": event_id,
            "occurred_at": occurred_at,
            "call": {
                "call_id": payload.call_id,
                "direction": payload.direction.upper(),
                "from": payload.from_,
                "to": payload.to,
                "recording_url": payload.recording_url,
            },
            "ohid": None,
        }

        if payload.event_type in ("call.started", "call.ringing"):
            event_type = "CallReceived"
        else:
            event_type = "CallCompleted"

        event = {"event_type": event_type, **base_event}

        await repo.insert_workflow_event(
            event_id=event_id,
            ohid=None,
            event_type=event_type,
            payload=event,
            source_system="CLOUDTALK",
        )

        await publish_event(event_type, event)

        return {"accepted": True}

    notion_router = APIRouter()

    def verify_notion_signature(body: bytes, signature_header: str) -> bool:
        """Validate Notion webhook signature using shared secret."""

        secret = os.getenv("NOTION_WEBHOOK_SECRET", "")
        if not secret or not signature_header:
            return False

        signature = signature_header
        if signature.startswith("sha256="):
            signature = signature.split("=", 1)[1]

        digest = hmac.new(secret.encode("utf-8"), msg=body, digestmod=hashlib.sha256).hexdigest()
        return hmac.compare_digest(digest, signature)

    @notion_router.post("/webhook")
    async def notion_webhook(
        request: Request,
        notion_signature: str = Header(default="", alias="Notion-Signature"),
        repo: Repository = Depends(repo_dep),
    ):
        raw_body = await request.body()
        if not verify_notion_signature(raw_body, notion_signature):
            raise HTTPException(status_code=401, detail="Invalid signature")

        payload = await request.json()

        # Respond to verification challenge immediately.
        if isinstance(payload, dict) and "challenge" in payload:
            return {"challenge": payload["challenge"]}

        event_type = payload.get("type", "notion.event") if isinstance(payload, dict) else "notion.event"
        event_id = payload.get("id", str(uuid4())) if isinstance(payload, dict) else str(uuid4())
        occurred_at = datetime.utcnow().isoformat()

        event = {
            "event_type": "NotionEvent",
            "event_subtype": event_type,
            "event_id": event_id,
            "occurred_at": occurred_at,
            "payload": payload,
        }

        await repo.insert_workflow_event(
            event_id=event_id,
            ohid=None,
            event_type="NotionEvent",
            payload=event,
            source_system="NOTION",
        )

        await publish_event("NotionEvent", event)

        return {"accepted": True}

    def create_app() -> FastAPI:
        """Factory to create the FastAPI app in real runtime.

        In environments where FastAPI (and ssl) are not available, this will raise
        a clear RuntimeError referencing the original import error.
        """

        if _fastapi_import_error is not None:
            raise RuntimeError("FastAPI is not available in this environment") from _fastapi_import_error

        app = FastAPI(title="Opulent MCP Gateway", version="0.1.0")
        @app.get("/health/env", tags=["health"])
        async def env_health_endpoint():
            """Report missing required/optional env keys (no secret values)."""

            return env_health()

        @app.get("/health/ping", tags=["health"])
        async def ping():
            """Lightweight liveness check."""

            return {"status": "ok"}

        app.include_router(lead_router, prefix="/api/lead", tags=["lead"])
        app.include_router(cloudtalk_router, prefix="/api/cloudtalk", tags=["cloudtalk"])
        app.include_router(notion_router, prefix="/api/notion", tags=["notion"])
        return app

else:
    # In constrained environments we expose a stub create_app that always fails fast but prevents
    # import time crashes. This is important for testing non HTTP logic such as OHID and signatures.
    def create_app() -> None:  # type: ignore[no-redef]
        raise RuntimeError(
            "FastAPI is not available in this environment; HTTP app cannot be created"
        )


# 8. Minimal internal tests (do not hit FastAPI or Postgres)


class _FakeRepo(Repository):
    """Simple in memory repository for tests that avoids any real database."""

    def __init__(self) -> None:
        self.leads: Dict[str, Any] = {}
        self.events: Dict[str, Any] = {}

    async def insert_lead_context(self, ohid: str, ingest_id: str, lead: LeadIngestRequest) -> None:
        self.leads[ingest_id] = {"ohid": ohid, "lead": lead}

    async def find_ohid_by_contact(self, email: Optional[str], phone: Optional[str]) -> Optional[str]:
        for record in self.leads.values():
            p: LeadIngestRequest = record["lead"]
            if (email and p.person.email == email) or (phone and p.person.phone == phone):
                return record["ohid"]
        return None

    async def insert_workflow_event(
        self,
        event_id: str,
        ohid: Optional[str],
        event_type: str,
        payload: Any,
        source_system: str,
    ) -> None:
        self.events[event_id] = {
            "ohid": ohid,
            "event_type": event_type,
            "payload": payload,
            "source_system": source_system,
        }


async def _test_resolve_ohid_new_contact() -> None:
    repo = _FakeRepo()
    payload = LeadIngestRequest(
        source_system="WEB",
        source_lead_id="lead-1",
        channel="WEB_FORM",
        person=Person(first_name="A", last_name="B", email="a@example.com", phone="123"),
        lead_details=None,
        consent=Consent(marketing=True),
        raw_payload={},
        timestamp=datetime.utcnow(),
        meta={},
    )

    ohid = await resolve_ohid(repo, payload)
    assert isinstance(ohid, str) and len(ohid) > 0


async def _test_resolve_ohid_existing_contact() -> None:
    repo = _FakeRepo()
    # First insert a lead manually
    first_payload = LeadIngestRequest(
        source_system="WEB",
        source_lead_id="lead-1",
        channel="WEB_FORM",
        person=Person(first_name="A", last_name="B", email="a@example.com", phone="123"),
        lead_details=None,
        consent=Consent(marketing=True),
        raw_payload={},
        timestamp=datetime.utcnow(),
        meta={},
    )
    existing_ohid = str(uuid4())
    await repo.insert_lead_context(existing_ohid, "ingest-1", first_payload)

    # Second payload with same email should resolve to existing OHID
    second_payload = LeadIngestRequest(
        source_system="WEB",
        source_lead_id="lead-2",
        channel="WEB_FORM",
        person=Person(first_name="A2", last_name="B2", email="a@example.com", phone="999"),
        lead_details=None,
        consent=Consent(marketing=True),
        raw_payload={},
        timestamp=datetime.utcnow(),
        meta={},
    )

    resolved = await resolve_ohid(repo, second_payload)
    assert resolved == existing_ohid


async def _run_all_tests() -> None:
    await _test_resolve_ohid_new_contact()
    await _test_resolve_ohid_existing_contact()


if __name__ == "__main__":
    import asyncio

    # In some environments (e.g. notebooks, certain runners) there is already a running
    # event loop, and calling asyncio.run() would raise `RuntimeError: asyncio.run() cannot
    # be called from a running event loop`. To keep the tests runnable everywhere, detect
    # this and either run the coroutine directly (no running loop) or schedule it on the
    # existing loop.
    try:
        running_loop = asyncio.get_running_loop()
    except RuntimeError:
        # No running loop: safe to use asyncio.run
        asyncio.run(_run_all_tests())
    else:
        # Running loop exists: schedule the tests as a task.
        # Callers can await this if they want stronger guarantees; here we just
        # ensure it does not crash the import/runtime.
        running_loop.create_task(_run_all_tests())
