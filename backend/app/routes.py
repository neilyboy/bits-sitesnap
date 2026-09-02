"""API routes for SiteSnap."""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import (
    clear_failed_attempts,
    issue_token,
    record_failed_attempt,
    require_auth,
    verify_pin,
)
from .config import get_settings
from .db import get_db
from .models import AudioClip, Category, Image, Item, Site
from .schemas import (
    AudioMeta,
    AudioOut,
    CategoryIn,
    CategoryOut,
    HealthOut,
    ImageMeta,
    ImageOut,
    ItemIn,
    ItemOut,
    PinChange,
    PinLogin,
    SiteIn,
    SiteOut,
    SyncPullRequest,
    SyncPullResponse,
    SyncPushRequest,
    SyncPushResponse,
    TokenOut,
)
from .seed import list_categories
from .sync import (
    pull_changed,
    push_audio_metas,
    push_image_metas,
    push_items,
    push_sites,
)
from .transcribe import enqueue as enqueue_transcription
from .util import slugify

log = logging.getLogger("sitesnap.api")

router = APIRouter(prefix="/api")


# ---------- Health ----------
@router.get("/health", response_model=HealthOut)
def health():
    return HealthOut()


# ---------- Auth ----------
@router.post("/auth/login", response_model=TokenOut)
def login(body: PinLogin, request: Request):
    settings = get_settings()
    client_key = request.client.host if request.client else "unknown"
    # Rate limit handled inside verify_pin path; check here too.
    from .auth import check_rate_limit
    check_rate_limit(client_key)
    if not verify_pin(body.pin):
        record_failed_attempt(client_key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect PIN.")
    clear_failed_attempts(client_key)
    token, exp = issue_token()
    return TokenOut(token=token, expires_at=exp)


@router.post("/auth/change-pin", response_model=TokenOut)
def change_pin(body: PinChange, _=Depends(require_auth)):
    from .auth import _hasher
    settings = get_settings()
    if not verify_pin(body.old_pin):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Old PIN incorrect.")
    new_hash = _hasher.hash(body.new_pin)
    # Persist by writing to config/.env (or env override). We update the
    # in-memory settings; for durability we also write to a file.
    env_path = Path("/app/config/.env")
    if not env_path.exists():
        env_path = Path.cwd() / "config" / ".env"
    _update_env_file(env_path, "SITESNAP_PIN_HASH", new_hash)
    settings.sitesnap_pin_hash = new_hash
    token, exp = issue_token()
    return TokenOut(token=token, expires_at=exp)


def _update_env_file(path: Path, key: str, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    found = False
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{key}="):
                lines.append(f"{key}={value}")
                found = True
            else:
                lines.append(line)
    if not found:
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------- Categories ----------
@router.get("/categories", response_model=list[CategoryOut])
def get_categories(_=Depends(require_auth), db: Session = Depends(get_db)):
    return list_categories()


@router.post("/categories", response_model=CategoryOut)
def add_category(body: CategoryIn, _=Depends(require_auth), db: Session = Depends(get_db)):
    slug = slugify(body.name)
    existing = db.scalar(select(Category).where(Category.slug == slug))
    if existing:
        raise HTTPException(status_code=409, detail="Category already exists.")
    cat = Category(name=body.name, slug=slug, sort_order=body.sort_order, is_default=False)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


# ---------- Sites ----------
def _site_to_out(s: Site, db: Session) -> SiteOut:
    from sqlalchemy import func
    count = db.scalar(
        select(func.count(Item.id)).where(Item.site_id == s.id, Item.deleted == False)  # noqa: E712
    ) or 0
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
        item_count=count,
    )


@router.get("/sites", response_model=list[SiteOut])
def list_sites(_=Depends(require_auth), db: Session = Depends(get_db)):
    rows = db.scalars(select(Site).order_by(Site.server_updated_at.desc())).all()
    return [_site_to_out(s, db) for s in rows]


@router.get("/sites/{site_id}", response_model=SiteOut)
def get_site(site_id: int, _=Depends(require_auth), db: Session = Depends(get_db)):
    s = db.get(Site, site_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Site not found.")
    return _site_to_out(s, db)


@router.post("/sites", response_model=SiteOut)
def create_site(body: SiteIn, _=Depends(require_auth), db: Session = Depends(get_db)):
    existing = db.scalar(select(Site).where(Site.client_uuid == body.client_uuid))
    if existing:
        raise HTTPException(status_code=409, detail="client_uuid already exists.")
    now = datetime.now(timezone.utc)
    s = Site(
        client_uuid=body.client_uuid,
        business_name=body.business_name,
        address_line1=body.address_line1,
        address_line2=body.address_line2,
        city=body.city,
        state=body.state,
        zip=body.zip,
        contact_name=body.contact_name,
        contact_phone=body.contact_phone,
        contact_email=body.contact_email,
        surveyor_name=body.surveyor_name,
        survey_date=body.survey_date,
        general_notes=body.general_notes,
        sync_status="synced",
        deleted=False,
        server_updated_at=now,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _site_to_out(s, db)


@router.put("/sites/{site_id}", response_model=SiteOut)
def update_site(site_id: int, body: SiteIn, _=Depends(require_auth), db: Session = Depends(get_db)):
    s = db.get(Site, site_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Site not found.")
    s.business_name = body.business_name
    s.address_line1 = body.address_line1
    s.address_line2 = body.address_line2
    s.city = body.city
    s.state = body.state
    s.zip = body.zip
    s.contact_name = body.contact_name
    s.contact_phone = body.contact_phone
    s.contact_email = body.contact_email
    s.surveyor_name = body.surveyor_name
    s.survey_date = body.survey_date
    s.general_notes = body.general_notes
    s.server_updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(s)
    return _site_to_out(s, db)


@router.delete("/sites/{site_id}")
def delete_site(site_id: int, _=Depends(require_auth), db: Session = Depends(get_db)):
    s = db.get(Site, site_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Site not found.")
    s.deleted = True
    s.server_updated_at = datetime.now(timezone.utc)
    # Cascade soft-delete to items/images/audio
    items = db.scalars(select(Item).where(Item.site_id == site_id, Item.deleted == False)).all()  # noqa: E712
    for it in items:
        it.deleted = True
        it.server_updated_at = s.server_updated_at
        for img in it.images:
            img.deleted = True
            img.server_updated_at = s.server_updated_at
        for a in it.audio_clips:
            a.deleted = True
            a.server_updated_at = s.server_updated_at
    db.commit()
    return {"ok": True}


# ---------- Items ----------
def _item_to_out(i: Item, db: Session) -> ItemOut:
    from sqlalchemy import func
    count = db.scalar(
        select(func.count(Image.id)).where(Image.item_id == i.id, Image.deleted == False)  # noqa: E712
    ) or 0
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
        image_count=count,
    )


@router.get("/items", response_model=list[ItemOut])
def list_items(site_id: int, _=Depends(require_auth), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Item).where(Item.site_id == site_id).order_by(Item.sort_order, Item.id)
    ).all()
    return [_item_to_out(i, db) for i in rows]


# ---------- Images ----------
def _image_to_out(img: Image) -> ImageOut:
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
        url=f"/api/images/{img.id}/file",
    )


@router.post("/items/{item_id}/images", response_model=ImageOut)
async def upload_image(
    item_id: int,
    file: UploadFile = File(...),
    client_uuid: str = Form(...),
    filename: str = Form(""),
    taken_at: str = Form(""),
    sort_order: int = Form(0),
    _=Depends(require_auth),
    db: Session = Depends(get_db),
):
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found.")
    settings = get_settings()
    data = await file.read()
    sha = hashlib.sha256(data).hexdigest()

    # Store under images/<site_client_uuid>/<item_client_uuid>/<image_client_uuid>.<ext>
    site = db.get(Site, item.site_id)
    ext = Path(file.filename or "image.jpg").suffix.lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"):
        ext = ".jpg"
    rel_path = f"{site.client_uuid}/{item.client_uuid}/{client_uuid}{ext}"
    abs_path = settings.images_dir / rel_path
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(data)

    # Read dimensions
    width = height = 0
    try:
        from PIL import Image as PILImage
        with PILImage.open(abs_path) as im:
            width, height = im.size
    except Exception:
        pass

    img = Image(
        client_uuid=client_uuid,
        item_id=item_id,
        file_path=rel_path,
        filename=filename or file.filename or "image.jpg",
        mime=file.content_type or "image/jpeg",
        width=width,
        height=height,
        taken_at=taken_at,
        sha256=sha,
        sort_order=sort_order,
        sync_status="synced",
        deleted=False,
        server_updated_at=datetime.now(timezone.utc),
    )
    db.add(img)
    db.commit()
    db.refresh(img)
    return _image_to_out(img)


@router.get("/images/{image_id}/file")
def get_image_file(image_id: int, _=Depends(require_auth), db: Session = Depends(get_db)):
    img = db.get(Image, image_id)
    if img is None or img.deleted:
        raise HTTPException(status_code=404, detail="Image not found.")
    settings = get_settings()
    path = settings.images_dir / img.file_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Image file missing.")
    return FileResponse(path, media_type=img.mime or "image/jpeg")


@router.delete("/images/{image_id}")
def delete_image(image_id: int, _=Depends(require_auth), db: Session = Depends(get_db)):
    img = db.get(Image, image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    img.deleted = True
    img.server_updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


# ---------- Audio ----------
def _audio_to_out(a: AudioClip) -> AudioOut:
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


@router.post("/items/{item_id}/audio", response_model=AudioOut)
async def upload_audio(
    item_id: int,
    file: UploadFile = File(...),
    client_uuid: str = Form(...),
    duration_sec: float = Form(0.0),
    transcript_text: str = Form(""),  # client-provided (Web Speech) — skips Whisper
    _=Depends(require_auth),
    db: Session = Depends(get_db),
):
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found.")
    settings = get_settings()
    data = await file.read()

    site = db.get(Site, item.site_id)
    ext = ".webm"
    if file.filename:
        ext = Path(file.filename).suffix.lower() or ".webm"
    rel_path = f"{site.client_uuid}/{item.client_uuid}/{client_uuid}{ext}"
    abs_path = settings.audio_dir / rel_path
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(data)

    status = "done" if transcript_text else "pending"
    clip = AudioClip(
        client_uuid=client_uuid,
        item_id=item_id,
        file_path=rel_path,
        duration_sec=duration_sec,
        transcript_text=transcript_text,
        transcript_status=status,
        sync_status="synced",
        deleted=False,
        server_updated_at=datetime.now(timezone.utc),
    )
    db.add(clip)
    db.commit()
    db.refresh(clip)

    if not transcript_text:
        enqueue_transcription(clip.id)

    return _audio_to_out(clip)


@router.get("/audio/{audio_id}", response_model=AudioOut)
def get_audio(audio_id: int, _=Depends(require_auth), db: Session = Depends(get_db)):
    a = db.get(AudioClip, audio_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Audio clip not found.")
    return _audio_to_out(a)


@router.post("/audio/{audio_id}/retranscribe")
def retranscribe(audio_id: int, _=Depends(require_auth), db: Session = Depends(get_db)):
    a = db.get(AudioClip, audio_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Audio clip not found.")
    a.transcript_status = "pending"
    a.transcript_text = ""
    a.transcript_error = ""
    db.commit()
    enqueue_transcription(a.id)
    return {"ok": True}


# ---------- Sync ----------
@router.post("/sync/push", response_model=SyncPushResponse)
def sync_push(body: SyncPushRequest, request: Request, _=Depends(require_auth), db: Session = Depends(get_db)):
    base_url = str(request.base_url).rstrip("/")
    sites = push_sites(db, body.sites)
    site_map = {s.client_uuid: s.id for s in sites}
    items = push_items(db, body.items, site_map)
    item_map = {i.client_uuid: i.id for i in items}
    images = push_image_metas(db, body.image_metas, item_map)
    audio = push_audio_metas(db, body.audio_metas, item_map)
    db.commit()

    return SyncPushResponse(
        server_time=datetime.now(timezone.utc),
        sites=[_site_to_out(s, db) for s in sites],
        items=[_item_to_out(i, db) for i in items],
        images=[_image_to_out(img) for img in images],
        audio=[_audio_to_out(a) for a in audio],
    )


@router.post("/sync/pull", response_model=SyncPullResponse)
def sync_pull(body: SyncPullRequest, request: Request, _=Depends(require_auth), db: Session = Depends(get_db)):
    base_url = str(request.base_url).rstrip("/")
    data = pull_changed(db, body.last_sync_at, base_url=base_url)
    cats = list_categories()
    return SyncPullResponse(
        server_time=data["server_time"],
        sites=data["sites"],
        items=data["items"],
        images=data["images"],
        audio=data["audio"],
        categories=[CategoryOut.model_validate(c) for c in cats],
    )


# ---------- Exports ----------
@router.post("/sites/{site_id}/export/pdf")
def export_pdf(site_id: int, _=Depends(require_auth), db: Session = Depends(get_db)):
    from .exports.pdf import generate_pdf
    try:
        pdf_bytes, filename = generate_pdf(db, site_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/sites/{site_id}/export/html")
def export_html(site_id: int, _=Depends(require_auth), db: Session = Depends(get_db)):
    from .exports.html import generate_html
    try:
        html_bytes, filename = generate_html(db, site_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=html_bytes,
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/sites/{site_id}/export/zip")
def export_zip(site_id: int, _=Depends(require_auth), db: Session = Depends(get_db)):
    from .exports.zip import generate_zip
    try:
        zip_bytes, filename = generate_zip(db, site_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
