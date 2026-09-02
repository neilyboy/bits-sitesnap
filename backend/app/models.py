"""SQLAlchemy ORM models."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Site(Base):
    __tablename__ = "sites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_uuid: Mapped[str] = mapped_column(String(64), unique=True, index=True)

    business_name: Mapped[str] = mapped_column(String(255), default="")
    address_line1: Mapped[str] = mapped_column(String(255), default="")
    address_line2: Mapped[str] = mapped_column(String(255), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    state: Mapped[str] = mapped_column(String(120), default="")
    zip: Mapped[str] = mapped_column(String(20), default="")
    contact_name: Mapped[str] = mapped_column(String(255), default="")
    contact_phone: Mapped[str] = mapped_column(String(60), default="")
    contact_email: Mapped[str] = mapped_column(String(255), default="")
    surveyor_name: Mapped[str] = mapped_column(String(255), default="")
    survey_date: Mapped[str] = mapped_column(String(20), default="")  # ISO date
    general_notes: Mapped[str] = mapped_column(Text, default="")
    logo_path: Mapped[str] = mapped_column(String(255), default="")  # relative path under images dir

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)
    server_updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)
    sync_status: Mapped[str] = mapped_column(String(16), default="synced")
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    items: Mapped[list["Item"]] = relationship(
        back_populates="site", cascade="all, delete-orphan", order_by="Item.sort_order"
    )


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_uuid: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)

    category: Mapped[str] = mapped_column(String(80), default="Other")
    label: Mapped[str] = mapped_column(String(255), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)
    server_updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)
    sync_status: Mapped[str] = mapped_column(String(16), default="synced")
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    site: Mapped["Site"] = relationship(back_populates="items")
    images: Mapped[list["Image"]] = relationship(
        back_populates="item", cascade="all, delete-orphan", order_by="Image.sort_order"
    )
    audio_clips: Mapped[list["AudioClip"]] = relationship(
        back_populates="item", cascade="all, delete-orphan"
    )


class Image(Base):
    __tablename__ = "images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_uuid: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)

    file_path: Mapped[str] = mapped_column(String(512), default="")  # relative to images_dir
    filename: Mapped[str] = mapped_column(String(255), default="")
    mime: Mapped[str] = mapped_column(String(80), default="image/jpeg")
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    taken_at: Mapped[str] = mapped_column(String(40), default="")
    sha256: Mapped[str] = mapped_column(String(64), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)
    server_updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)
    sync_status: Mapped[str] = mapped_column(String(16), default="synced")
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    item: Mapped["Item"] = relationship(back_populates="images")


class AudioClip(Base):
    __tablename__ = "audio_clips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_uuid: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)

    file_path: Mapped[str] = mapped_column(String(512), default="")  # relative to audio_dir
    duration_sec: Mapped[float] = mapped_column(Float, default=0.0)
    transcript_text: Mapped[str] = mapped_column(Text, default="")
    transcript_status: Mapped[str] = mapped_column(String(16), default="pending")
    transcript_error: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)
    server_updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)
    sync_status: Mapped[str] = mapped_column(String(16), default="synced")
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    item: Mapped["Item"] = relationship(back_populates="audio_clips")


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("slug", name="uq_categories_slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(80))
    slug: Mapped[str] = mapped_column(String(80))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class TranscriptionJob(Base):
    """Lightweight durable queue for server-side Whisper transcription."""
    __tablename__ = "transcription_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    audio_id: Mapped[int] = mapped_column(ForeignKey("audio_clips.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued|running|done|failed
    error: Mapped[str] = mapped_column(Text, default="")
    queued_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
