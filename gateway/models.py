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
    direction: str
    from_: str = Field(alias="from")
    to: str
    recording_url: Optional[str] = None
    raw: Dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(populate_by_name=True)
