"""Sync engine: UUID-based upsert + last-write-wins pull.

Push: client sends records with sync_status='pending'. We upsert by
client_uuid. Last-write-wins on updated_at (client wall clock).

Pull: client sends last_sync_at (server time from previous pull). We return
all records with server_updated_at > last_sync_at.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AudioClip, Image, Item, Site
from .schemas import (
    AudioMeta,
    AudioOut,
    ImageMeta,
    ImageOut,
    ItemIn,
    ItemOut,
    SiteIn,
    SiteOut,
)
from .transcribe import enqueue as enqueue_transcription


def _dt(v) -> datetime:
    if v is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if isinstance(v, datetime):
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v
    return v


def _site_out(s: Site, item_count: int = 0) -> SiteOut:
    return SiteOut(
        id=s.id,
        client_uuid=s.client_uuid,
        business_name=s.business_name,
        address_line1=s.address_line1,
        address_line2=s.address_line2,
        city=s.city,
        state=s.state,
        zip=s.zip,
        contact_name=s.contact_name,
        contact_phone=s.contact_phone,
        contact_email=s.contact_email,
        surveyor_name=s.surveyor_name,
        survey_date=s.survey_date,
        general_notes=s.general_notes,
        created_at=s.created_at,
        updated_at=s.updated_at,
        server_updated_at=s.server_updated_at,
        sync_status=s.sync_status,
        deleted=s.deleted,
        item_count=item_count,
    )


def _item_out(i: Item, image_count: int = 0) -> ItemOut:
    return ItemOut(
        id=i.id,
        client_uuid=i.client_uuid,
        site_id=i.site_id,
        category=i.category,
        label=i.label,
        notes=i.notes,
        sort_order=i.sort_order,
        created_at=i.created_at,
        updated_at=i.updated_at,
        server_updated_at=i.server_updated_at,
        sync_status=i.sync_status,
        deleted=i.deleted,
        image_count=image_count,
    )


def _image_out(img: Image, base_url: str = "") -> ImageOut:
    return ImageOut(
        id=img.id,
        client_uuid=img.client_uuid,
        item_id=img.item_id,
        filename=img.filename,
        mime=img.mime,
        width=img.width,
        height=img.height,
        taken_at=img.taken_at,
        sha256=img.sha256,
        sort_order=img.sort_order,
        created_at=img.created_at,
        updated_at=img.updated_at,
        server_updated_at=img.server_updated_at,
        sync_status=img.sync_status,
        deleted=img.deleted,
        # Always return a RELATIVE url — the frontend constructs the full
        # URL using its configured server_url setting.  Returning an
        # absolute url with the server's hostname (e.g. localhost) breaks
        # image loading on other devices (phones, tablets) where that
        # hostname doesn't resolve to the server.
        url=f"/api/images/{img.id}/file",
    )


def _audio_out(a: AudioClip) -> AudioOut:
    return AudioOut(
        id=a.id,
        client_uuid=a.client_uuid,
        item_id=a.item_id,
        duration_sec=a.duration_sec,
        transcript_text=a.transcript_text,
        transcript_status=a.transcript_status,
        transcript_error=a.transcript_error,
        created_at=a.created_at,
        updated_at=a.updated_at,
        server_updated_at=a.server_updated_at,
        sync_status=a.sync_status,
        deleted=a.deleted,
    )


# ---------- PUSH ----------
def push_sites(s: Session, payload: Iterable[SiteIn]) -> list[Site]:
    now = datetime.now(timezone.utc)
    results = []
    for rec in payload:
        existing = s.scalar(select(Site).where(Site.client_uuid == rec.client_uuid))
        if existing is None:
            obj = Site(
                client_uuid=rec.client_uuid,
                business_name=rec.business_name,
                address_line1=rec.address_line1,
                address_line2=rec.address_line2,
                city=rec.city,
                state=rec.state,
                zip=rec.zip,
                contact_name=rec.contact_name,
                contact_phone=rec.contact_phone,
                contact_email=rec.contact_email,
                surveyor_name=rec.surveyor_name,
                survey_date=rec.survey_date,
                general_notes=rec.general_notes,
                sync_status="synced",
                deleted=rec.deleted,
                server_updated_at=now,
            )
            s.add(obj)
            s.flush()
            results.append(obj)
        else:
            # last-write-wins: client's updated_at is authoritative for content.
            existing.business_name = rec.business_name
            existing.address_line1 = rec.address_line1
            existing.address_line2 = rec.address_line2
            existing.city = rec.city
            existing.state = rec.state
            existing.zip = rec.zip
            existing.contact_name = rec.contact_name
            existing.contact_phone = rec.contact_phone
            existing.contact_email = rec.contact_email
            existing.surveyor_name = rec.surveyor_name
            existing.survey_date = rec.survey_date
            existing.general_notes = rec.general_notes
            existing.sync_status = "synced"
            existing.deleted = rec.deleted
            existing.server_updated_at = now
            results.append(existing)
    s.flush()
    return results


def push_items(s: Session, payload: Iterable[ItemIn], site_map: dict[str, int]) -> list[Item]:
    now = datetime.now(timezone.utc)
    results = []
    for rec in payload:
        site_id = site_map.get(rec.site_client_uuid)
        if site_id is None:
            # Try to resolve from DB (in case site was pushed in a prior batch).
            site = s.scalar(select(Site).where(Site.client_uuid == rec.site_client_uuid))
            if site is None:
                continue
            site_id = site.id
            site_map[rec.site_client_uuid] = site_id

        existing = s.scalar(select(Item).where(Item.client_uuid == rec.client_uuid))
        if existing is None:
            obj = Item(
                client_uuid=rec.client_uuid,
                site_id=site_id,
                category=rec.category,
                label=rec.label,
                notes=rec.notes,
                sort_order=rec.sort_order,
                sync_status="synced",
                deleted=rec.deleted,
                server_updated_at=now,
            )
            s.add(obj)
            results.append(obj)
        else:
            existing.site_id = site_id
            existing.category = rec.category
            existing.label = rec.label
            existing.notes = rec.notes
            existing.sort_order = rec.sort_order
            existing.sync_status = "synced"
            existing.deleted = rec.deleted
            existing.server_updated_at = now
            results.append(existing)
    s.flush()
    return results


def push_image_metas(
    s: Session, payload: Iterable[ImageMeta], item_map: dict[str, int]
) -> list[Image]:
    now = datetime.now(timezone.utc)
    results = []
    for rec in payload:
        item_id = item_map.get(rec.item_client_uuid)
        if item_id is None:
            item = s.scalar(select(Item).where(Item.client_uuid == rec.item_client_uuid))
            if item is None:
                continue
            item_id = item.id
            item_map[rec.item_client_uuid] = item_id

        existing = s.scalar(select(Image).where(Image.client_uuid == rec.client_uuid))
        if existing is None:
            obj = Image(
                client_uuid=rec.client_uuid,
                item_id=item_id,
                filename=rec.filename,
                mime=rec.mime,
                width=rec.width,
                height=rec.height,
                taken_at=rec.taken_at,
                sha256=rec.sha256,
                sort_order=rec.sort_order,
                sync_status="synced",
                deleted=rec.deleted,
                server_updated_at=now,
            )
            s.add(obj)
            results.append(obj)
        else:
            existing.item_id = item_id
            existing.filename = rec.filename
            existing.mime = rec.mime
            existing.width = rec.width
            existing.height = rec.height
            existing.taken_at = rec.taken_at
            existing.sha256 = rec.sha256
            existing.sort_order = rec.sort_order
            existing.sync_status = "synced"
            existing.deleted = rec.deleted
            existing.server_updated_at = now
            results.append(existing)
    s.flush()
    return results


def push_audio_metas(
    s: Session, payload: Iterable[AudioMeta], item_map: dict[str, int]
) -> list[AudioClip]:
    now = datetime.now(timezone.utc)
    results = []
    for rec in payload:
        item_id = item_map.get(rec.item_client_uuid)
        if item_id is None:
            item = s.scalar(select(Item).where(Item.client_uuid == rec.item_client_uuid))
            if item is None:
                continue
            item_id = item.id
            item_map[rec.item_client_uuid] = item_id

        existing = s.scalar(select(AudioClip).where(AudioClip.client_uuid == rec.client_uuid))
        if existing is None:
            obj = AudioClip(
                client_uuid=rec.client_uuid,
                item_id=item_id,
                duration_sec=rec.duration_sec,
                transcript_text=rec.transcript_text,
                transcript_status="done" if rec.transcript_text else rec.transcript_status,
                sync_status="synced",
                deleted=rec.deleted,
                server_updated_at=now,
            )
            s.add(obj)
            results.append(obj)
            # If the client did NOT provide a transcript, queue server-side Whisper.
            if not rec.transcript_text and rec.transcript_status != "done":
                s.flush()
                enqueue_transcription(obj.id)
        else:
            existing.item_id = item_id
            existing.duration_sec = rec.duration_sec
            # Don't clobber a finished transcript with empty client text.
            if rec.transcript_text:
                existing.transcript_text = rec.transcript_text
                existing.transcript_status = "done"
            existing.sync_status = "synced"
            existing.deleted = rec.deleted
            existing.server_updated_at = now
            results.append(existing)
    s.flush()
    return results


# ---------- PULL ----------
def pull_changed(s: Session, since: datetime | None, base_url: str = "") -> dict:
    since_dt = _dt(since)
    sites = s.scalars(
        select(Site).where(Site.server_updated_at > since_dt).order_by(Site.server_updated_at)
    ).all()
    site_ids = {site.id for site in sites}

    items = s.scalars(
        select(Item).where(Item.server_updated_at > since_dt).order_by(Item.server_updated_at)
    ).all()
    item_ids = {item.id for item in items}

    images = s.scalars(
        select(Image).where(Image.server_updated_at > since_dt).order_by(Image.server_updated_at)
    ).all()
    audio = s.scalars(
        select(AudioClip).where(AudioClip.server_updated_at > since_dt).order_by(AudioClip.server_updated_at)
    ).all()

    # item counts for sites
    from sqlalchemy import func

    item_counts = dict(
        s.execute(
            select(Item.site_id, func.count(Item.id))
            .where(Item.deleted == False)  # noqa: E712
            .group_by(Item.site_id)
        ).all()
    )
    image_counts = dict(
        s.execute(
            select(Image.item_id, func.count(Image.id))
            .where(Image.deleted == False)  # noqa: E712
            .group_by(Image.item_id)
        ).all()
    )

    return {
        "server_time": datetime.now(timezone.utc),
        "sites": [_site_out(site, item_counts.get(site.id, 0)) for site in sites],
        "items": [_item_out(item, image_counts.get(item.id, 0)) for item in items],
        "images": [_image_out(img, base_url) for img in images],
        "audio": [_audio_out(a) for a in audio],
    }
