# Migration Playbook: Raw JSON-RPC Gateway → Claude MCP Server

**Date:** 2026-02-06
**Source:** Current `gateway/` package (broken raw JSON-RPC 2.0 over FastAPI)
**Target:** Official MCP Python SDK (`mcp` package v1.x) with Streamable HTTP transport

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Why Migrate](#2-why-migrate)
3. [Architecture Overview](#3-architecture-overview)
4. [Implementation Requirements](#4-implementation-requirements)
5. [Migration Plan (Phased)](#5-migration-plan-phased)
6. [File-by-File Mapping](#6-file-by-file-mapping)
7. [Implementation Playbook](#7-implementation-playbook)
8. [Testing Strategy](#8-testing-strategy)
9. [Infrastructure Changes](#9-infrastructure-changes)
10. [Rollback Plan](#10-rollback-plan)
11. [Open Questions](#11-open-questions)

---

## 1. Executive Summary

The current repository implements a hand-rolled JSON-RPC 2.0 gateway over FastAPI that is:
- **Broken** — `mcp_server.py` cannot import (7 missing symbols from a botched refactor)
- **Non-compliant** — does not implement the MCP protocol (no capability negotiation, no `initialize`, no session management)
- **Incomplete** — 5 of 6 advertised tools are non-functional

The migration replaces this with a proper MCP server built on the **official `mcp` Python SDK (v1.x)**, which provides:
- Full MCP protocol compliance out of the box
- Automatic JSON Schema generation from Python type hints
- Built-in stdio and Streamable HTTP transports
- Compatibility with Claude Desktop, Claude Code, Cursor, and any MCP client
- Zero hand-written JSON-RPC framing

All existing business logic (6 tools, webhook validation, lead ingestion, environment health) is preserved and ported.

---

## 2. Why Migrate

| Aspect | Current (Raw JSON-RPC) | Target (MCP SDK) |
|--------|----------------------|-------------------|
| Protocol compliance | Partial (3 methods) | Full MCP spec |
| Tool registration | Manual dict schemas | `@mcp.tool()` decorator + auto-schema |
| Tool dispatch | Manual `if/elif` chain | Automatic framework routing |
| Transport | HTTP only (FastAPI) | stdio + Streamable HTTP |
| Client compatibility | Custom clients only | Claude Desktop, Claude Code, Cursor, etc. |
| Session management | None | Built-in `Mcp-Session-Id` |
| Capability negotiation | None | Built-in `initialize` handshake |
| JSON-RPC framing | Manual construction | Abstracted away |
| Auth | Hard-coded token | Env-var bearer token / OAuth 2.1 ready |
| Dev tools | None | `mcp dev` inspector, `mcp run` CLI |
| Lines of boilerplate | ~230 (mcp_server.py) | ~0 |

---

## 3. Architecture Overview

### Current Architecture (broken)
```
gateway/
├── __init__.py          → exports create_app
├── main.py              → FastAPI app factory (80 lines, inline /api/rpc)
├── mcp_server.py        → JSON-RPC handler + 6 tools (228 lines, BROKEN imports)
├── mcp_router.py        → FastAPI router (never registered, DEAD CODE)
├── healthcheck.py       → CLI env check (BROKEN — imports deleted env_health)
└── openapi_check.py     → OpenAPI probe (works but irrelevant to MCP)
```

### Target Architecture
```
gateway/
├── __init__.py          → package marker
├── server.py            → MCP server definition (FastMCP instance + tool registrations)
├── models.py            → Pydantic domain models (restored from git history)
├── services/
│   ├── __init__.py
│   ├── webhooks.py      → CloudTalk + Notion HMAC-SHA256 validation
│   ├── leads.py         → Lead ingestion + OHID resolution
│   ├── workflows.py     → N8N workflow trigger
│   └── health.py        → Environment health check
├── repository.py        → Repository ABC + FakeRepo + PostgresRepo
├── app.py               → Optional: FastAPI wrapper for HTTP health endpoints
└── tests/
    ├── __init__.py
    ├── test_tools.py     → Unit tests for all 6 MCP tools
    ├── test_webhooks.py  → HMAC validation tests
    ├── test_leads.py     → Lead ingestion + OHID tests
    └── test_server.py    → MCP protocol integration tests
```

### How it runs
```
# stdio transport (for Claude Desktop / Claude Code)
$ mcp run gateway/server.py

# Streamable HTTP transport (for remote/deployed access)
$ python gateway/server.py  (calls mcp.run(transport="streamable-http"))

# Development inspector
$ mcp dev gateway/server.py
```

---

## 4. Implementation Requirements

### 4.1 Python Version

**Minimum: Python 3.10** (required by `mcp` SDK)

The current `pyproject.toml` declares `>=3.9`. This must be bumped to `>=3.10`.

### 4.2 Dependencies

**Add:**
```
mcp>=1.25,<2           # Official MCP Python SDK (pin to v1.x stable)
```

**Keep:**
```
pydantic>=2.5.0        # Domain models (used by MCP SDK internally too)
httpx>=0.25.0          # N8N workflow trigger HTTP calls
python-dotenv>=1.0.0   # Local .env loading
```

**Keep (but make optional):**
```
sqlalchemy[asyncio]>=2.0.0   # PostgresRepository (when REPOSITORY_IMPL=postgres)
asyncpg>=0.29.0              # PostgreSQL async driver
```

**Remove:**
```
fastapi>=0.110.0             # No longer the primary server framework
uvicorn[standard]>=0.27.0    # MCP SDK handles its own HTTP server
python-jsonrpc-server>=0.4.0 # Never used, MCP SDK handles JSON-RPC
```

**Optional — keep FastAPI if dual-mode HTTP health endpoint is desired:**
```
fastapi>=0.110.0             # Only for /health/ping HTTP endpoint alongside MCP
uvicorn[standard]>=0.27.0    # Only if serving FastAPI alongside MCP
```

### 4.3 Business Logic to Preserve

All 6 tools, their signatures, and behavior must be carried over:

| # | Tool | Inputs | Output | Complexity |
|---|------|--------|--------|------------|
| 1 | `health_ping` | (none) | `{"status": "pong"}` | Trivial |
| 2 | `health_env` | (none) | `{"status", "missing_required", "missing_optional"}` | Low — env var check |
| 3 | `lead_ingest` | `source_system`, `source_lead_id`, `channel`, `first_name`, `last_name`, `email?`, `phone?` | `{"ohid", "ingest_id"}` | Medium — model validation, OHID resolution, repo persistence |
| 4 | `cloudtalk_webhook_validator` | `body` (string), `signature` (string) | `{"valid": bool, "parsed": dict}` | Low — HMAC-SHA256 + Pydantic parse |
| 5 | `notion_webhook_validator` | `body` (string), `signature` (string) | `{"valid": bool}` | Low — HMAC-SHA256 |
| 6 | `n8n_workflow_trigger` | `payload` (dict) | `{"status_code", "body"}` | Low — HTTP POST |

### 4.4 Domain Models to Restore

These were deleted in commit `8c214da` and must be re-created from the original code (commit `207909d`):

```python
# gateway/models.py

class Person(BaseModel):
    first_name: str
    last_name: str
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
    source_system: str  # META|WEB|CLOUDTALK|ZOHO_SOCIAL|ZOHO_CRM
    source_lead_id: str
    channel: str        # WEB_FORM|META_LEAD_AD|INBOUND_CALL|OUTBOUND_CALL|SOCIAL|CRM
    person: Person
    lead_details: Optional[LeadDetails] = None
    consent: Consent
    raw_payload: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime
    meta: Dict[str, Any] = Field(default_factory=dict)

class CloudtalkWebhookPayload(BaseModel):
    event_type: str
    call_id: str
    direction: str
    from_: str = Field(alias="from")
    to: str
    recording_url: Optional[str] = None
    raw: Dict[str, Any] = Field(default_factory=dict)
    model_config = ConfigDict(populate_by_name=True)
```

### 4.5 Repository Layer to Restore

```python
# gateway/repository.py

class Repository(ABC):
    async def insert_lead_context(self, ohid, ingest_id, lead) -> None: ...
    async def find_ohid_by_contact(self, email, phone) -> Optional[str]: ...
    async def insert_workflow_event(self, event_id, ohid, event_type, payload, source_system) -> None: ...

class FakeRepo(Repository):
    """In-memory implementation for development and testing."""

class PostgresRepo(Repository):
    """SQLAlchemy async implementation for production."""
```

### 4.6 Environment Variables

No changes to the env var set. All existing variables remain valid:

| Variable | Required | Used By |
|----------|----------|---------|
| `MCP_AUTH_TOKEN` | Yes | Bearer auth (server startup validation) |
| `CLOUDTALK_WEBHOOK_SECRET` | Yes | `cloudtalk_webhook_validator` tool |
| `NOTION_WEBHOOK_SECRET` | Yes | `notion_webhook_validator` tool |
| `N8N_WEBHOOK_URL` | Yes | `n8n_workflow_trigger` tool |
| `PGHOST/PORT/USER/PASSWORD/DATABASE` | Conditional | When `REPOSITORY_IMPL=postgres` |
| `REPOSITORY_IMPL` | No | Selects repo backend (default: `fake`) |
| `ELEVENLABS_API_KEY/VOICE_ID/MODEL_ID` | No | Reported by `health_env` |
| `OPENAI_API_KEY` | No | Reported by `health_env` |

### 4.7 Security Requirements

1. **Remove hard-coded token** — `main.py:24` must be deleted; all auth via `MCP_AUTH_TOKEN` env var
2. **Bearer token validation** — use MCP SDK's auth hooks or a startup check
3. **HMAC secrets** — remain in env vars, never in code
4. **Timing-safe comparison** — `hmac.compare_digest()` already used (preserve this)

---

## 5. Migration Plan (Phased)

### Phase 1: Foundation (Files: `models.py`, `repository.py`, `services/`)
> Restore all deleted business logic into clean modules. No MCP dependency yet. Fully testable in isolation.

- [ ] Create `gateway/models.py` with all Pydantic domain models
- [ ] Create `gateway/repository.py` with `Repository` ABC, `FakeRepo`, `PostgresRepo`
- [ ] Create `gateway/services/health.py` with `env_health()`
- [ ] Create `gateway/services/webhooks.py` with HMAC validation functions
- [ ] Create `gateway/services/leads.py` with `resolve_ohid()` and lead ingestion logic
- [ ] Create `gateway/services/workflows.py` with N8N trigger logic
- [ ] Write unit tests for all of the above

### Phase 2: MCP Server (Files: `server.py`)
> Build the MCP server using the official SDK, wiring tools to Phase 1 services.

- [ ] Add `mcp>=1.25,<2` dependency to `pyproject.toml`
- [ ] Bump `requires-python` to `>=3.10`
- [ ] Create `gateway/server.py` with `FastMCP` instance and 6 `@mcp.tool()` registrations
- [ ] Add server lifespan for repository initialization
- [ ] Add bearer token auth check (startup validation or request middleware)
- [ ] Test with `mcp dev gateway/server.py`
- [ ] Test stdio transport: `mcp run gateway/server.py`
- [ ] Test Streamable HTTP transport

### Phase 3: Cleanup (Remove old code)
> Delete the old broken implementation and update all configuration.

- [ ] Delete `gateway/main.py` (old FastAPI app)
- [ ] Delete `gateway/mcp_server.py` (old JSON-RPC handler)
- [ ] Delete `gateway/mcp_router.py` (dead router)
- [ ] Delete `gateway/openapi_check.py` (irrelevant to MCP)
- [ ] Update `gateway/__init__.py`
- [ ] Update `gateway/healthcheck.py` to import from new location
- [ ] Remove unused dependencies from `pyproject.toml`

### Phase 4: Infrastructure (Files: `Dockerfile`, `docker-compose.yml`, Terraform, CI)
> Update deployment to serve the new MCP server.

- [ ] Update `Dockerfile` CMD to run MCP server
- [ ] Update `docker-compose.yml`
- [ ] Fix AWS health check path in Terraform
- [ ] Update CI pipeline to run `pytest` instead of `python gateway/main.py`
- [ ] Update `README.md`, `INTEGRATION_STEPS.md`, `AGENTS.md`

---

## 6. File-by-File Mapping

### Files to CREATE

| New File | Source | Purpose |
|----------|--------|---------|
| `gateway/server.py` | New | MCP server (FastMCP + tool registrations) |
| `gateway/models.py` | Restored from commit `207909d` | Pydantic domain models |
| `gateway/repository.py` | Restored from commit `207909d` | Repository ABC + implementations |
| `gateway/services/__init__.py` | New | Package marker |
| `gateway/services/health.py` | Extracted from original `main.py` | `env_health()` |
| `gateway/services/webhooks.py` | Extracted from `mcp_server.py:139-156` | HMAC validation |
| `gateway/services/leads.py` | Extracted from original `main.py` | OHID resolution + ingestion |
| `gateway/services/workflows.py` | Extracted from `mcp_server.py:178-184` | N8N trigger |
| `gateway/tests/__init__.py` | New | Test package |
| `gateway/tests/test_tools.py` | New | Tool unit tests |
| `gateway/tests/test_webhooks.py` | New | HMAC validation tests |
| `gateway/tests/test_leads.py` | New | Lead ingestion tests |
| `gateway/tests/test_server.py` | New | MCP integration tests |

### Files to DELETE

| File | Reason |
|------|--------|
| `gateway/main.py` | Replaced by `server.py`; old FastAPI app no longer needed |
| `gateway/mcp_server.py` | Replaced by `server.py` + `services/`; broken imports |
| `gateway/mcp_router.py` | Dead code (never registered); replaced by MCP transport |
| `gateway/openapi_check.py` | Irrelevant — MCP servers don't expose OpenAPI |

### Files to MODIFY

| File | Changes |
|------|---------|
| `pyproject.toml` | Add `mcp`, remove `fastapi`/`uvicorn`/`python-jsonrpc-server`, bump Python to 3.10 |
| `gateway/__init__.py` | Update exports |
| `gateway/healthcheck.py` | Import `env_health` from `services.health` instead of `main` |
| `Dockerfile` | Change CMD to `mcp run gateway/server.py` or `python gateway/server.py` |
| `docker-compose.yml` | Remove deprecated `version` field |
| `.github/workflows/build-and-push.yml` | Replace `python gateway/main.py` with `pytest` |
| `infra/aws/modules/ecs_service/main.tf` | Fix health check path from `/rpc` to `/health` or remove ALB |
| `README.md` | Update quick start, usage, and architecture |
| `AGENTS.md` | Update project structure and commands |
| `INTEGRATION_STEPS.md` | Rewrite for MCP SDK usage |
| `.env.example` | No changes needed |

---

## 7. Implementation Playbook

### Step 1: Create `gateway/models.py`

Restore all Pydantic models from commit `207909d`. This is a pure data definition file with no external dependencies beyond Pydantic.

```python
"""Domain models for the Opulent MCP Gateway."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field


class Person(BaseModel):
    first_name: str
    last_name: str
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
    source_system: str = Field(
        ..., pattern=r"^(META|WEB|CLOUDTALK|ZOHO_SOCIAL|ZOHO_CRM)$"
    )
    source_lead_id: str
    channel: str = Field(
        ..., pattern=r"^(WEB_FORM|META_LEAD_AD|INBOUND_CALL|OUTBOUND_CALL|SOCIAL|CRM)$"
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
    direction: str
    from_: str = Field(alias="from")
    to: str
    recording_url: Optional[str] = None
    raw: Dict[str, Any] = Field(default_factory=dict)
    model_config = ConfigDict(populate_by_name=True)
```

### Step 2: Create `gateway/repository.py`

Restore the repository abstraction. `FakeRepo` for dev/test, `PostgresRepo` for production.

```python
"""Repository abstraction for lead and event persistence."""
from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class Repository(ABC):
    @abstractmethod
    async def insert_lead_context(self, ohid: str, ingest_id: str, lead: Any) -> None: ...

    @abstractmethod
    async def find_ohid_by_contact(self, email: Optional[str], phone: Optional[str]) -> Optional[str]: ...

    @abstractmethod
    async def insert_workflow_event(self, event_id: str, ohid: str, event_type: str, payload: Dict, source_system: str) -> None: ...


class FakeRepo(Repository):
    """In-memory repository for development and testing."""

    def __init__(self) -> None:
        self.leads: Dict[str, Any] = {}
        self.events: Dict[str, Any] = {}

    async def insert_lead_context(self, ohid, ingest_id, lead):
        self.leads[ingest_id] = {"ohid": ohid, "lead": lead}

    async def find_ohid_by_contact(self, email, phone):
        return None  # No dedup in fake repo

    async def insert_workflow_event(self, event_id, ohid, event_type, payload, source_system):
        self.events[event_id] = {"ohid": ohid, "type": event_type, "payload": payload}


# PostgresRepo would be restored here when database support is needed.
# It uses SQLAlchemy async engine with asyncpg driver.
```

### Step 3: Create `gateway/services/` modules

Four small, focused service modules:

**`gateway/services/health.py`** — Environment health check
```python
import os
from typing import Any, Dict

REQUIRED_ENV_KEYS = [
    "CLOUDTALK_WEBHOOK_SECRET", "NOTION_WEBHOOK_SECRET",
    "N8N_WEBHOOK_URL", "MCP_AUTH_TOKEN",
]
OPTIONAL_ENV_KEYS = [
    "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE",
    "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID",
    "ELEVENLABS_MODEL_ID", "OPENAI_API_KEY",
]

def env_health() -> Dict[str, Any]:
    missing_req = [k for k in REQUIRED_ENV_KEYS if not os.getenv(k)]
    missing_opt = [k for k in OPTIONAL_ENV_KEYS if not os.getenv(k)]
    status = "ok" if not missing_req else "degraded"
    return {
        "status": status,
        "missing_required": missing_req,
        "missing_optional": missing_opt,
    }
```

**`gateway/services/webhooks.py`** — HMAC-SHA256 webhook validation
```python
import hashlib, hmac, os
from typing import Any, Dict
from ..models import CloudtalkWebhookPayload

def verify_cloudtalk_signature(body: bytes, signature: str) -> bool:
    secret = os.getenv("CLOUDTALK_WEBHOOK_SECRET", "")
    if not secret:
        return False
    expected = hmac.new(secret.encode(), msg=body, digestmod=hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

def verify_notion_signature(body: bytes, signature_header: str) -> bool:
    secret = os.getenv("NOTION_WEBHOOK_SECRET", "")
    if not secret or not signature_header:
        return False
    sig = signature_header
    if sig.startswith("sha256="):
        sig = sig.split("=", 1)[1]
    digest = hmac.new(secret.encode(), msg=body, digestmod=hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, sig)

def validate_cloudtalk(body_str: str, signature: str) -> Dict[str, Any]:
    body = body_str.encode("utf-8")
    valid = verify_cloudtalk_signature(body, signature)
    try:
        parsed = CloudtalkWebhookPayload.model_validate_json(body).model_dump()
    except Exception:
        parsed = {"parse": "failed"}
    return {"valid": valid, "parsed": parsed}

def validate_notion(body_str: str, signature: str) -> Dict[str, Any]:
    body = body_str.encode("utf-8")
    valid = verify_notion_signature(body, signature)
    return {"valid": valid}
```

**`gateway/services/leads.py`** — Lead ingestion + OHID resolution
```python
import uuid
from typing import Any, Dict
from ..models import Consent, LeadIngestRequest, Person
from ..repository import FakeRepo, Repository

async def resolve_ohid(repo: Repository, lead: LeadIngestRequest) -> str:
    existing = await repo.find_ohid_by_contact(lead.person.email, lead.person.phone)
    return existing or str(uuid.uuid4())

async def ingest_lead(args: Dict[str, Any], repo: Repository | None = None) -> Dict[str, Any]:
    if repo is None:
        repo = FakeRepo()
    payload = LeadIngestRequest(
        source_system=args["source_system"],
        source_lead_id=args["source_lead_id"],
        channel=args["channel"],
        person=Person(
            first_name=args["first_name"],
            last_name=args["last_name"],
            email=args.get("email"),
            phone=args.get("phone"),
        ),
        lead_details=None,
        consent=Consent(marketing=True),
        raw_payload={},
        timestamp=args.get("timestamp"),
        meta={},
    )
    ohid = await resolve_ohid(repo, payload)
    ingest_id = str(uuid.uuid4())
    await repo.insert_lead_context(ohid, ingest_id, payload)
    return {"ohid": ohid, "ingest_id": ingest_id}
```

**`gateway/services/workflows.py`** — N8N workflow trigger
```python
import os
from typing import Any, Dict
import httpx

async def trigger_n8n(payload: Dict[str, Any]) -> Dict[str, Any]:
    url = os.getenv("N8N_WEBHOOK_URL")
    if not url:
        raise ValueError("N8N_WEBHOOK_URL is not set")
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, json=payload)
        return {"status_code": resp.status_code, "body": resp.text}
```

### Step 4: Create `gateway/server.py` — the MCP server

This is the core of the migration. All tools registered via decorators, all JSON-RPC protocol handling automatic.

```python
"""Opulent MCP Gateway — built on the official MCP Python SDK."""
from __future__ import annotations

from typing import Any, Dict, Optional

from mcp.server.fastmcp import FastMCP

from .services import health, leads, webhooks, workflows

mcp = FastMCP(
    "opulent-mcp-gateway",
    version="0.2.0",
    description="MCP gateway with webhook validation, lead ingestion, and workflow triggers",
)


@mcp.tool()
def health_ping() -> dict:
    """Ping the MCP gateway to verify it is running."""
    return {"status": "pong"}


@mcp.tool()
def health_env() -> dict:
    """Report missing required and optional environment variables."""
    return health.env_health()


@mcp.tool()
async def lead_ingest(
    source_system: str,
    source_lead_id: str,
    channel: str,
    first_name: str,
    last_name: str,
    email: Optional[str] = None,
    phone: Optional[str] = None,
) -> dict:
    """Validate and ingest a lead. Returns the resolved OHID and ingest ID."""
    return await leads.ingest_lead({
        "source_system": source_system,
        "source_lead_id": source_lead_id,
        "channel": channel,
        "first_name": first_name,
        "last_name": last_name,
        "email": email,
        "phone": phone,
    })


@mcp.tool()
def cloudtalk_webhook_validator(body: str, signature: str) -> dict:
    """Validate a CloudTalk webhook HMAC-SHA256 signature and parse the payload."""
    return webhooks.validate_cloudtalk(body, signature)


@mcp.tool()
def notion_webhook_validator(body: str, signature: str) -> dict:
    """Validate a Notion webhook HMAC-SHA256 signature."""
    return webhooks.validate_notion(body, signature)


@mcp.tool()
async def n8n_workflow_trigger(payload: dict) -> dict:
    """POST a JSON payload to the configured N8N webhook URL."""
    return await workflows.trigger_n8n(payload)


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
```

### Step 5: Update `pyproject.toml`

```toml
[project]
name = "opulent-mcp-gateway"
version = "0.2.0"
description = "MCP Gateway with webhook validation, lead ingestion, and workflow triggers"
authors = [{ name = "Opulent Horizons" }]
requires-python = ">=3.10"
dependencies = [
    "mcp>=1.25,<2",
    "pydantic>=2.5.0",
    "httpx>=0.25.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
postgres = [
    "sqlalchemy[asyncio]>=2.0.0",
    "asyncpg>=0.29.0",
]
test = [
    "pytest>=7.4.0",
    "pytest-asyncio>=0.23.0",
]

[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"
```

### Step 6: Update `Dockerfile`

```dockerfile
FROM python:3.11-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY pyproject.toml setup.cfg ./
COPY gateway ./gateway
RUN pip install --no-cache-dir .

EXPOSE 8000

# Streamable HTTP transport for remote access
CMD ["python", "gateway/server.py"]
```

### Step 7: Update CI pipeline

Replace the no-op test step in `.github/workflows/build-and-push.yml`:

```yaml
      - name: Run tests
        run: |
          pytest gateway/tests/ -v
```

### Step 8: Update `gateway/__init__.py`

```python
"""Opulent MCP Gateway."""
```

### Step 9: Update `gateway/healthcheck.py`

```python
from .services.health import env_health
# ... rest of the file remains the same
```

### Step 10: Delete old files

```bash
rm gateway/main.py
rm gateway/mcp_server.py
rm gateway/mcp_router.py
rm gateway/openapi_check.py
```

### Step 11: Fix infrastructure

In `infra/aws/modules/ecs_service/main.tf`, update the health check:

```hcl
health_check {
    path    = "/health"   # or use TCP check on port 8000
    matcher = "200-399"
}
```

---

## 8. Testing Strategy

### Unit Tests (`gateway/tests/test_tools.py`)

Test each tool function in isolation:

```python
import pytest
from gateway.services.health import env_health
from gateway.services.webhooks import verify_cloudtalk_signature, verify_notion_signature
from gateway.services.leads import resolve_ohid, ingest_lead
from gateway.repository import FakeRepo

def test_health_ping():
    """health_ping returns pong."""

def test_env_health_reports_missing():
    """env_health correctly identifies missing env vars."""

@pytest.mark.asyncio
async def test_lead_ingest_creates_ohid():
    """lead_ingest generates a new OHID when no contact match exists."""

def test_cloudtalk_hmac_valid_signature(monkeypatch):
    """Valid HMAC-SHA256 signature passes verification."""

def test_cloudtalk_hmac_invalid_signature(monkeypatch):
    """Invalid signature fails verification."""

def test_notion_hmac_strips_prefix(monkeypatch):
    """Notion validator strips sha256= prefix before comparison."""
```

### MCP Integration Tests (`gateway/tests/test_server.py`)

Test the MCP server protocol using the SDK's test client:

```python
from mcp.client import ClientSession

@pytest.mark.asyncio
async def test_tools_list():
    """Server lists all 6 tools."""

@pytest.mark.asyncio
async def test_tool_call_health_ping():
    """Calling health_ping via MCP protocol returns pong."""
```

### Coverage Target

- **Phase 1 services:** >90% coverage (pure business logic, easy to test)
- **Phase 2 server:** >80% coverage (protocol integration, may need SDK test helpers)
- **Overall:** >80% (matching the goal in AGENTS.md)

---

## 9. Infrastructure Changes

| Component | Change | Impact |
|-----------|--------|--------|
| **Dockerfile** | CMD changes from uvicorn to `python gateway/server.py` | Container starts MCP server instead of FastAPI |
| **docker-compose.yml** | Remove `version: '3.9'` | Compatibility fix |
| **AWS Terraform** | Health check path `/rpc` → appropriate MCP health path | Prevents perpetual unhealthy status |
| **Azure Terraform** | No structural changes, env vars remain the same | Minimal impact |
| **CI/CD** | Test step becomes `pytest gateway/tests/ -v` | Actually runs tests |
| **Python version** | 3.9 → 3.10 minimum | May affect some deployment environments |

### Transport Considerations for Deployment

| Scenario | Transport | How to Run |
|----------|-----------|-----------|
| Claude Desktop (local) | stdio | `mcp run gateway/server.py` |
| Claude Code (local) | stdio | Configure in MCP settings |
| Remote/deployed server | Streamable HTTP | `python gateway/server.py` (port 8000) |
| Development/debugging | Inspector | `mcp dev gateway/server.py` |

---

## 10. Rollback Plan

The migration is a full replacement, not an incremental change. Rollback strategy:

1. **Git revert** — All changes are in new commits on a feature branch. Revert the merge if needed.
2. **Old code preserved in git history** — The original `main.py` (commit `207909d`) and the simplified version (commit `8c214da`) are both recoverable via `git checkout`.
3. **Dual-mode option** — If rollback risk is a concern, Phase 3 (delete old files) can be deferred, keeping both implementations temporarily.

---

## 11. Open Questions

1. **Database support timeline** — Should `PostgresRepo` be fully restored in this migration, or deferred until a PostgreSQL instance is provisioned? The playbook includes `FakeRepo` by default.

2. **FastAPI health endpoint** — Should we keep a simple HTTP `/health/ping` endpoint alongside the MCP server for load balancer health checks? The MCP SDK's Streamable HTTP transport may not expose custom HTTP routes.

3. **Auth model** — The current Bearer token approach is simple but non-standard for MCP. Should we implement OAuth 2.1 (per MCP spec) or keep env-var Bearer tokens for simplicity?

4. **ElevenLabs / OpenAI** — These env vars are declared but have no implementation. Should placeholder tools be created, or should they be removed from `env_health` until actually implemented?

5. **Event publishing** — The original code published `LeadIngested` events to N8N after lead ingestion. Should the `lead_ingest` tool also trigger N8N, or keep that as a separate `n8n_workflow_trigger` call?

---

## Appendix: Quick Reference Commands

```bash
# Install dependencies
pip install -e ".[test]"

# Run MCP server (stdio for local clients)
mcp run gateway/server.py

# Run MCP server (HTTP for remote clients)
python gateway/server.py

# Development inspector
mcp dev gateway/server.py

# Run tests
pytest gateway/tests/ -v

# Docker build and run
docker compose build && docker compose up
```
