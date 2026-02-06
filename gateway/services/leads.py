"""Lead ingestion and OHID resolution service."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from ..models import Consent, LeadIngestRequest, Person
from ..repository import FakeRepo, Repository


async def resolve_ohid(repo: Repository, lead: LeadIngestRequest) -> str:
    existing = await repo.find_ohid_by_contact(lead.person.email, lead.person.phone)
    return existing or str(uuid.uuid4())


async def ingest_lead(
    args: Dict[str, Any], repo: Optional[Repository] = None
) -> Dict[str, Any]:
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
        timestamp=datetime.now(timezone.utc),
        meta={},
    )
    ohid = await resolve_ohid(repo, payload)
    ingest_id = str(uuid.uuid4())
    await repo.insert_lead_context(ohid, ingest_id, payload)
    return {"ohid": ohid, "ingest_id": ingest_id}
