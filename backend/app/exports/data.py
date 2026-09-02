"""Build a structured report payload (site + items grouped by category)."""
from __future__ import annotations

import base64
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AudioClip, Image, Item, Site
from ..util import safe_filename

# Canonical display order for default categories. Custom ones append after.
DEFAULT_ORDER = [
    "Cameras",
    "Access Control",
    "Intercom",
    "Air Quality",
    "Alarms",
    "Workplace",
    "Other",
]


@dataclass
class ReportImage:
    image_id: int
    client_uuid: str
    filename: str
    mime: str
    abs_path: Path
    relative_path: str
    sort_order: int
    taken_at: str = ""
    data_url: str = ""  # base64 for HTML embedding


@dataclass
class ReportItem:
    item_id: int
    client_uuid: str
    category: str
    label: str
    notes: str
    sort_order: int
    images: list[ReportImage] = field(default_factory=list)
    audio_transcripts: list[str] = field(default_factory=list)


@dataclass
class ReportPayload:
    site: Site
    items: list[ReportItem]
    categories_in_order: list[str]
    brand_color: str


def _category_sort_key(name: str) -> tuple[int, int, str]:
    try:
        idx = DEFAULT_ORDER.index(name)
    except ValueError:
        idx = len(DEFAULT_ORDER)
    return (0, idx, name)


def build_report(s: Session, site_id: int, embed_images: bool = False) -> Optional[ReportPayload]:
    site = s.get(Site, site_id)
    if site is None:
        return None

    settings = get_settings()
    items = s.scalars(
        select(Item)
        .where(Item.site_id == site_id, Item.deleted == False)  # noqa: E712
        .order_by(Item.sort_order, Item.id)
    ).all()

    report_items: list[ReportItem] = []
    cats: set[str] = set()

    for it in items:
        imgs = s.scalars(
            select(Image)
            .where(Image.item_id == it.id, Image.deleted == False)  # noqa: E712
            .order_by(Image.sort_order, Image.id)
        ).all()
        audios = s.scalars(
            select(AudioClip)
            .where(AudioClip.item_id == it.id, AudioClip.deleted == False)  # noqa: E712
            .order_by(AudioClip.id)
        ).all()

        rep_imgs: list[ReportImage] = []
        for img in imgs:
            abs_path = settings.images_dir / img.file_path if img.file_path else None
            rel = img.file_path or ""
            data_url = ""
            if embed_images and abs_path and abs_path.exists():
                data_url = _file_to_data_url(abs_path, img.mime)
            rep_imgs.append(ReportImage(
                image_id=img.id,
                client_uuid=img.client_uuid,
                filename=img.filename or safe_filename(it.label) + ".jpg",
                mime=img.mime,
                abs_path=abs_path,
                relative_path=rel,
                sort_order=img.sort_order,
                taken_at=img.taken_at,
                data_url=data_url,
            ))

        transcripts = [a.transcript_text for a in audios if a.transcript_text]

        report_items.append(ReportItem(
            item_id=it.id,
            client_uuid=it.client_uuid,
            category=it.category,
            label=it.label,
            notes=it.notes,
            sort_order=it.sort_order,
            images=rep_imgs,
            audio_transcripts=transcripts,
        ))
        cats.add(it.category)

    ordered_cats = sorted(cats, key=_category_sort_key)
    return ReportPayload(
        site=site,
        items=report_items,
        categories_in_order=ordered_cats,
        brand_color=settings.brand_color,
    )


def _file_to_data_url(path: Path, mime: str) -> str:
    data = path.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{b64}"
