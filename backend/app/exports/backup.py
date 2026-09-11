"""Backup and restore: export/import the full database or individual sites as JSON.

Backups include all site metadata, items, images (as base64), audio clips
(with transcripts), and categories. Image and audio binaries are embedded
as base64 in the backup file so it's fully self-contained.
"""
from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AudioClip, Category, Image, Item, Site


def _file_to_b64(path: Path) -> str:
    """Read a file and return its contents as base64."""
    if not path or not path.exists():
        return ""
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _b64_to_file(data: str, path: Path) -> None:
    """Write base64 data to a file."""
    if not data:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(base64.b64decode(data))


def _site_to_dict(s: Session, site: Site, include_binaries: bool = True) -> dict:
    """Serialize a single site with all its items, images, and audio."""
    settings = get_settings()
    items = s.scalars(
        select(Item).where(Item.site_id == site.id).order_by(Item.sort_order, Item.id)
    ).all()

    items_data = []
    for it in items:
        images = s.scalars(
            select(Image).where(Image.item_id == it.id).order_by(Image.sort_order, Image.id)
        ).all()
        audios = s.scalars(
            select(AudioClip).where(AudioClip.item_id == it.id).order_by(AudioClip.id)
        ).all()

        images_data = []
        for img in images:
            img_dict = {
                "client_uuid": img.client_uuid,
                "filename": img.filename,
                "mime": img.mime,
                "width": img.width,
                "height": img.height,
                "taken_at": img.taken_at,
                "sha256": img.sha256,
                "sort_order": img.sort_order,
                "created_at": img.created_at.isoformat() if img.created_at else "",
                "updated_at": img.updated_at.isoformat() if img.updated_at else "",
                "sync_status": img.sync_status,
                "deleted": img.deleted,
                "file_data": "",
            }
            if include_binaries and img.file_path:
                abs_path = settings.images_dir / img.file_path
                img_dict["file_data"] = _file_to_b64(abs_path)
            images_data.append(img_dict)

        audio_data = []
        for a in audios:
            a_dict = {
                "client_uuid": a.client_uuid,
                "duration_sec": a.duration_sec,
                "transcript_text": a.transcript_text,
                "transcript_status": a.transcript_status,
                "transcript_error": a.transcript_error,
                "created_at": a.created_at.isoformat() if a.created_at else "",
                "updated_at": a.updated_at.isoformat() if a.updated_at else "",
                "sync_status": a.sync_status,
                "deleted": a.deleted,
                "file_data": "",
            }
            if include_binaries and a.file_path:
                abs_path = settings.audio_dir / a.file_path
                a_dict["file_data"] = _file_to_b64(abs_path)
            audio_data.append(a_dict)

        items_data.append({
            "client_uuid": it.client_uuid,
            "category": it.category,
            "label": it.label,
            "notes": it.notes,
            "sort_order": it.sort_order,
            "created_at": it.created_at.isoformat() if it.created_at else "",
            "updated_at": it.updated_at.isoformat() if it.updated_at else "",
            "sync_status": it.sync_status,
            "deleted": it.deleted,
            "images": images_data,
            "audio": audio_data,
        })

    # Site logo
    logo_data = ""
    if include_binaries and site.logo_path:
        logo_abs = settings.images_dir / site.logo_path
        logo_data = _file_to_b64(logo_abs)

    return {
        "client_uuid": site.client_uuid,
        "business_name": site.business_name,
        "address_line1": site.address_line1,
        "address_line2": site.address_line2,
        "city": site.city,
        "state": site.state,
        "zip": site.zip,
        "contact_name": site.contact_name,
        "contact_phone": site.contact_phone,
        "contact_email": site.contact_email,
        "surveyor_name": site.surveyor_name,
        "survey_date": site.survey_date,
        "general_notes": site.general_notes,
        "logo_path": site.logo_path,
        "logo_data": logo_data,
        "share_token": site.share_token,
        "created_at": site.created_at.isoformat() if site.created_at else "",
        "updated_at": site.updated_at.isoformat() if site.updated_at else "",
        "sync_status": site.sync_status,
        "deleted": site.deleted,
        "items": items_data,
    }


def export_full_backup(s: Session) -> tuple[bytes, str]:
    """Export the entire database as a JSON backup file."""
    sites = s.scalars(select(Site).order_by(Site.id)).all()
    cats = s.scalars(select(Category).order_by(Category.sort_order, Category.id)).all()

    backup = {
        "format": "sitesnap-backup",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "categories": [
            {"name": c.name, "slug": c.slug, "sort_order": c.sort_order, "is_default": c.is_default}
            for c in cats
        ],
        "sites": [_site_to_dict(s, site) for site in sites],
    }

    data = json.dumps(backup, indent=2, ensure_ascii=False).encode("utf-8")
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"sitesnap_backup_{ts}.json"
    return data, filename


def export_site_backup(s: Session, site_id: int) -> tuple[bytes, str]:
    """Export a single site as a JSON backup file."""
    site = s.get(Site, site_id)
    if site is None:
        raise FileNotFoundError(f"Site {site_id} not found")

    cats = s.scalars(select(Category).order_by(Category.sort_order, Category.id)).all()

    backup = {
        "format": "sitesnap-backup",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "categories": [
            {"name": c.name, "slug": c.slug, "sort_order": c.sort_order, "is_default": c.is_default}
            for c in cats
        ],
        "sites": [_site_to_dict(s, site)],
    }

    data = json.dumps(backup, indent=2, ensure_ascii=False).encode("utf-8")
    safe_name = site.business_name or f"site_{site_id}"
    safe_name = "".join(c for c in safe_name if c.isalnum() or c in "-_ ")[:60].strip() or "site"
    filename = f"sitesnap_{safe_name}.json"
    return data, filename


def _parse_dt(s: str) -> datetime:
    if not s:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return datetime.now(timezone.utc)


def import_backup(s: Session, data: bytes, overwrite: bool = False) -> dict:
    """Import a backup file. Returns a summary of what was imported.

    Args:
        s: Database session
        data: JSON backup bytes
        overwrite: If True, replace existing sites with the same client_uuid.
                   If False, skip sites that already exist.
    """
    backup = json.loads(data.decode("utf-8"))
    if backup.get("format") != "sitesnap-backup":
        raise ValueError("Not a valid SiteSnap backup file")

    settings = get_settings()
    now = datetime.now(timezone.utc)

    # Import categories (add missing ones)
    cats_added = 0
    for cat_data in backup.get("categories", []):
        existing = s.scalar(select(Category).where(Category.slug == cat_data["slug"]))
        if not existing:
            s.add(Category(
                name=cat_data["name"],
                slug=cat_data["slug"],
                sort_order=cat_data["sort_order"],
                is_default=cat_data["is_default"],
            ))
            cats_added += 1

    sites_imported = 0
    sites_skipped = 0
    items_imported = 0
    images_imported = 0
    audio_imported = 0

    for site_data in backup.get("sites", []):
        client_uuid = site_data["client_uuid"]
        existing_site = s.scalar(select(Site).where(Site.client_uuid == client_uuid))

        if existing_site and not overwrite:
            sites_skipped += 1
            continue

        if existing_site and overwrite:
            # Delete existing items/images/audio for this site
            old_items = s.scalars(select(Item).where(Item.site_id == existing_site.id)).all()
            for it in old_items:
                s.scalars(select(Image).where(Image.item_id == it.id)).all()  # cascade
                s.scalars(select(AudioClip).where(AudioClip.item_id == it.id)).all()  # cascade
                s.delete(it)
            s.delete(existing_site)
            s.flush()

        # Create site
        site = Site(
            client_uuid=client_uuid,
            business_name=site_data.get("business_name", ""),
            address_line1=site_data.get("address_line1", ""),
            address_line2=site_data.get("address_line2", ""),
            city=site_data.get("city", ""),
            state=site_data.get("state", ""),
            zip=site_data.get("zip", ""),
            contact_name=site_data.get("contact_name", ""),
            contact_phone=site_data.get("contact_phone", ""),
            contact_email=site_data.get("contact_email", ""),
            surveyor_name=site_data.get("surveyor_name", ""),
            survey_date=site_data.get("survey_date", ""),
            general_notes=site_data.get("general_notes", ""),
            share_token=site_data.get("share_token", ""),
            created_at=_parse_dt(site_data.get("created_at", "")),
            updated_at=now,
            server_updated_at=now,
            sync_status="synced",
            deleted=site_data.get("deleted", False),
        )

        # Restore logo
        logo_data = site_data.get("logo_data", "")
        logo_path = site_data.get("logo_path", "")
        if logo_data and logo_path:
            logo_abs = settings.images_dir / logo_path
            _b64_to_file(logo_data, logo_abs)
            site.logo_path = logo_path
        elif logo_path:
            site.logo_path = logo_path

        s.add(site)
        s.flush()  # get site.id
        sites_imported += 1

        # Import items
        for item_data in site_data.get("items", []):
            item = Item(
                client_uuid=item_data["client_uuid"],
                site_id=site.id,
                category=item_data.get("category", "Other"),
                label=item_data.get("label", ""),
                notes=item_data.get("notes", ""),
                sort_order=item_data.get("sort_order", 0),
                created_at=_parse_dt(item_data.get("created_at", "")),
                updated_at=now,
                server_updated_at=now,
                sync_status="synced",
                deleted=item_data.get("deleted", False),
            )
            s.add(item)
            s.flush()
            items_imported += 1

            # Import images
            for img_data in item_data.get("images", []):
                img = Image(
                    client_uuid=img_data["client_uuid"],
                    item_id=item.id,
                    filename=img_data.get("filename", ""),
                    mime=img_data.get("mime", "image/jpeg"),
                    width=img_data.get("width", 0),
                    height=img_data.get("height", 0),
                    taken_at=img_data.get("taken_at", ""),
                    sha256=img_data.get("sha256", ""),
                    sort_order=img_data.get("sort_order", 0),
                    created_at=_parse_dt(img_data.get("created_at", "")),
                    updated_at=now,
                    server_updated_at=now,
                    sync_status="synced",
                    deleted=img_data.get("deleted", False),
                )
                # Restore image file
                file_data = img_data.get("file_data", "")
                if file_data:
                    # Use the original filename/path pattern
                    file_path = f"{img_data['client_uuid']}.jpg"
                    abs_path = settings.images_dir / file_path
                    _b64_to_file(file_data, abs_path)
                    img.file_path = file_path
                s.add(img)
                images_imported += 1

            # Import audio
            for a_data in item_data.get("audio", []):
                audio = AudioClip(
                    client_uuid=a_data["client_uuid"],
                    item_id=item.id,
                    duration_sec=a_data.get("duration_sec", 0.0),
                    transcript_text=a_data.get("transcript_text", ""),
                    transcript_status=a_data.get("transcript_status", "pending"),
                    transcript_error=a_data.get("transcript_error", ""),
                    created_at=_parse_dt(a_data.get("created_at", "")),
                    updated_at=now,
                    server_updated_at=now,
                    sync_status="synced",
                    deleted=a_data.get("deleted", False),
                )
                # Restore audio file
                file_data = a_data.get("file_data", "")
                if file_data:
                    file_path = f"{a_data['client_uuid']}.webm"
                    abs_path = settings.audio_dir / file_path
                    _b64_to_file(file_data, abs_path)
                    audio.file_path = file_path
                s.add(audio)
                audio_imported += 1

    s.commit()

    return {
        "sites_imported": sites_imported,
        "sites_skipped": sites_skipped,
        "items_imported": items_imported,
        "images_imported": images_imported,
        "audio_imported": audio_imported,
        "categories_added": cats_added,
    }
