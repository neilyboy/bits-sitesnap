"""Pydantic request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------- Auth ----------
class PinLogin(BaseModel):
    pin: str = Field(min_length=4, max_length=32)


class TokenOut(BaseModel):
    token: str
    expires_at: datetime


class PinChange(BaseModel):
    old_pin: str
    new_pin: str = Field(min_length=4, max_length=32)


# ---------- Categories ----------
class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    slug: str
    sort_order: int
    is_default: bool


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sort_order: int = 0


# ---------- Sites ----------
class SiteBase(BaseModel):
    business_name: str = ""
    address_line1: str = ""
    address_line2: str = ""
    city: str = ""
    state: str = ""
    zip: str = ""
    contact_name: str = ""
    contact_phone: str = ""
    contact_email: str = ""
    surveyor_name: str = ""
    survey_date: str = ""
    general_notes: str = ""


class SiteIn(SiteBase):
    client_uuid: str
    survey_date: str = ""
    deleted: bool = False


class SiteOut(SiteBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    client_uuid: str
    created_at: datetime
    updated_at: datetime
    server_updated_at: datetime
    sync_status: str
    deleted: bool
    item_count: int = 0
    logo_url: str = ""


# ---------- Items ----------
class ItemBase(BaseModel):
    category: str = "Other"
    label: str = ""
    notes: str = ""
    sort_order: int = 0


class ItemIn(ItemBase):
    client_uuid: str
    site_client_uuid: str
    deleted: bool = False


class ItemOut(ItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    client_uuid: str
    site_id: int
    created_at: datetime
    updated_at: datetime
    server_updated_at: datetime
    sync_status: str
    deleted: bool
    image_count: int = 0


# ---------- Images ----------
class ImageMeta(BaseModel):
    client_uuid: str
    item_client_uuid: str
    filename: str = ""
    mime: str = "image/jpeg"
    width: int = 0
    height: int = 0
    taken_at: str = ""
    sha256: str = ""
    sort_order: int = 0
    deleted: bool = False


class ImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    client_uuid: str
    item_id: int
    filename: str
    mime: str
    width: int
    height: int
    taken_at: str
    sha256: str
    sort_order: int
    created_at: datetime
    updated_at: datetime
    server_updated_at: datetime
    sync_status: str
    deleted: bool
    url: str = ""


# ---------- Audio ----------
class AudioMeta(BaseModel):
    client_uuid: str
    item_client_uuid: str
    duration_sec: float = 0.0
    # If the client already produced a transcript (Web Speech API), send it here
    # and the server will skip Whisper transcription.
    transcript_text: str = ""
    transcript_status: str = "pending"
    deleted: bool = False


class AudioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    client_uuid: str
    item_id: int
    duration_sec: float
    transcript_text: str
    transcript_status: str
    transcript_error: str = ""
    created_at: datetime
    updated_at: datetime
    server_updated_at: datetime
    sync_status: str
    deleted: bool


# ---------- Sync ----------
class SyncPullRequest(BaseModel):
    last_sync_at: Optional[datetime] = None


class SyncPushRequest(BaseModel):
    sites: list[SiteIn] = Field(default_factory=list)
    items: list[ItemIn] = Field(default_factory=list)
    image_metas: list[ImageMeta] = Field(default_factory=list)
    audio_metas: list[AudioMeta] = Field(default_factory=list)


class SyncPushResponse(BaseModel):
    server_time: datetime
    sites: list[SiteOut]
    items: list[ItemOut]
    images: list[ImageOut]
    audio: list[AudioOut]


class SyncPullResponse(BaseModel):
    server_time: datetime
    sites: list[SiteOut]
    items: list[ItemOut]
    images: list[ImageOut]
    audio: list[AudioOut]
    categories: list[CategoryOut]


# ---------- Misc ----------
class HealthOut(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
