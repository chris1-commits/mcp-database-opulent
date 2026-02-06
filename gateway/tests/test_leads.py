"""Tests for lead ingestion and OHID resolution."""
import uuid

import pytest

from gateway.models import Consent, LeadIngestRequest, Person
from gateway.repository import FakeRepo
from gateway.services.leads import ingest_lead, resolve_ohid


def _make_lead(email="a@example.com", phone="123") -> LeadIngestRequest:
    from datetime import datetime, timezone

    return LeadIngestRequest(
        source_system="WEB",
        source_lead_id="lead-1",
        channel="WEB_FORM",
        person=Person(first_name="A", last_name="B", email=email, phone=phone),
        lead_details=None,
        consent=Consent(marketing=True),
        raw_payload={},
        timestamp=datetime.now(timezone.utc),
        meta={},
    )


async def test_resolve_ohid_new_contact():
    """New contact gets a new UUID as OHID."""
    repo = FakeRepo()
    lead = _make_lead()
    ohid = await resolve_ohid(repo, lead)
    assert isinstance(ohid, str)
    uuid.UUID(ohid)  # validates it's a proper UUID


async def test_resolve_ohid_existing_email():
    """Existing contact matched by email returns existing OHID."""
    repo = FakeRepo()
    lead = _make_lead(email="a@example.com")
    existing_ohid = str(uuid.uuid4())
    await repo.insert_lead_context(existing_ohid, "ingest-1", lead)

    second_lead = _make_lead(email="a@example.com", phone="999")
    resolved = await resolve_ohid(repo, second_lead)
    assert resolved == existing_ohid


async def test_resolve_ohid_existing_phone():
    """Existing contact matched by phone returns existing OHID."""
    repo = FakeRepo()
    lead = _make_lead(email="x@example.com", phone="555")
    existing_ohid = str(uuid.uuid4())
    await repo.insert_lead_context(existing_ohid, "ingest-1", lead)

    second_lead = _make_lead(email="different@example.com", phone="555")
    resolved = await resolve_ohid(repo, second_lead)
    assert resolved == existing_ohid


async def test_ingest_lead_returns_ohid_and_ingest_id():
    """ingest_lead returns both ohid and ingest_id as UUIDs."""
    result = await ingest_lead(
        {
            "source_system": "WEB",
            "source_lead_id": "lead-42",
            "channel": "WEB_FORM",
            "first_name": "Alice",
            "last_name": "Smith",
            "email": "alice@example.com",
        }
    )
    assert "ohid" in result
    assert "ingest_id" in result
    uuid.UUID(result["ohid"])
    uuid.UUID(result["ingest_id"])


async def test_ingest_lead_persists_to_repo():
    """ingest_lead stores the lead in the repository."""
    repo = FakeRepo()
    result = await ingest_lead(
        {
            "source_system": "META",
            "source_lead_id": "lead-99",
            "channel": "META_LEAD_AD",
            "first_name": "Bob",
            "last_name": "Jones",
        },
        repo=repo,
    )
    assert result["ingest_id"] in repo.leads


async def test_ingest_lead_validates_source_system():
    """Invalid source_system raises a validation error."""
    with pytest.raises(Exception):
        await ingest_lead(
            {
                "source_system": "INVALID",
                "source_lead_id": "lead-1",
                "channel": "WEB_FORM",
                "first_name": "A",
                "last_name": "B",
            }
        )


async def test_ingest_lead_validates_channel():
    """Invalid channel raises a validation error."""
    with pytest.raises(Exception):
        await ingest_lead(
            {
                "source_system": "WEB",
                "source_lead_id": "lead-1",
                "channel": "INVALID_CHANNEL",
                "first_name": "A",
                "last_name": "B",
            }
        )
