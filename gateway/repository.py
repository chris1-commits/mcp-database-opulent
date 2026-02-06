"""Repository abstraction for lead and event persistence."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from .models import LeadIngestRequest


class Repository(ABC):
    @abstractmethod
    async def insert_lead_context(
        self, ohid: str, ingest_id: str, lead: LeadIngestRequest
    ) -> None: ...

    @abstractmethod
    async def find_ohid_by_contact(
        self, email: Optional[str], phone: Optional[str]
    ) -> Optional[str]: ...

    @abstractmethod
    async def insert_workflow_event(
        self,
        event_id: str,
        ohid: Optional[str],
        event_type: str,
        payload: Dict[str, Any],
        source_system: str,
    ) -> None: ...


class FakeRepo(Repository):
    """In-memory repository for development and testing."""

    def __init__(self) -> None:
        self.leads: Dict[str, Any] = {}
        self.events: Dict[str, Any] = {}

    async def insert_lead_context(self, ohid, ingest_id, lead):
        self.leads[ingest_id] = {"ohid": ohid, "lead": lead}

    async def find_ohid_by_contact(self, email, phone):
        for record in self.leads.values():
            p: LeadIngestRequest = record["lead"]
            if (email and p.person.email == email) or (
                phone and p.person.phone == phone
            ):
                return record["ohid"]
        return None

    async def insert_workflow_event(
        self, event_id, ohid, event_type, payload, source_system
    ):
        self.events[event_id] = {
            "ohid": ohid,
            "event_type": event_type,
            "payload": payload,
            "source_system": source_system,
        }
