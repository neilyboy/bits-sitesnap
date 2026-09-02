"""ZIP export: every image with notes overlaid as a solid bar at the bottom,
plus a manifest.csv."""
from __future__ import annotations

import csv
import io
import zipfile
from datetime import datetime, timezone

from PIL import Image as PILImage, ImageDraw, ImageFont
from sqlalchemy.orm import Session

from ..util import safe_filename, slugify
from .data import build_report


def _load_font(size: int) -> ImageFont.ImageFont:
    """Try DejaVuSans (installed in container), fall back to default bitmap."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _wrap_text(text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    """Greedy word-wrap to fit max_width pixels."""
    if not text:
        return []
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        trial = f"{cur} {w}".strip()
        try:
            bbox = font.getbbox(trial)
            width = bbox[2] - bbox[0]
        except Exception:
            width = len(trial) * (font.size // 2)
        if width <= max_width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _overlay_text(img_path, notes: str, brand_color: str) -> bytes:
    """Open image, paste a solid brand-color bar at the bottom with the note
    text in white. Return JPEG bytes."""
    img = PILImage.open(img_path)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    elif img.mode == "RGBA":
        # Flatten onto white for JPEG output.
        bg = PILImage.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        img = bg

    w, h = img.size
    if not notes:
        # No notes: still normalize to JPEG.
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=88)
        return buf.getvalue()

    # Auto-size font based on image width.
    font_size = max(14, min(40, w // 38))
    font = _load_font(font_size)
    line_height = int(font_size * 1.4)
    padding = max(8, w // 80)

    max_text_width = w - 2 * padding
    lines = _wrap_text(notes, font, max_text_width)
    bar_height = padding * 2 + line_height * len(lines)

    # Extend canvas: paste original on a taller canvas with brand bar.
    new_h = h + bar_height
    canvas = PILImage.new("RGB", (w, new_h), (255, 255, 255))
    canvas.paste(img, (0, 0))

    # Brand color bar.
    try:
        brand = tuple(int(brand_color.lstrip("#")[i:i+2], 16) for i in (0, 2, 4))
    except Exception:
        brand = (11, 31, 58)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([(0, h), (w, new_h)], fill=brand)

    # Draw wrapped text in white.
    y = h + padding
    for line in lines:
        draw.text((padding, y), line, fill=(255, 255, 255), font=font)
        y += line_height

    buf = io.BytesIO()
    canvas.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


def generate_zip(s: Session, site_id: int) -> tuple[bytes, str]:
    payload = build_report(s, site_id, embed_images=False)
    if payload is None:
        raise FileNotFoundError(f"Site {site_id} not found")

    buf = io.BytesIO()
    site_slug = slugify(payload.site.business_name or "site")

    manifest_rows = []
    item_counter = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for cat in payload.categories_in_order:
            cat_items = [i for i in payload.items if i.category == cat]
            for it in cat_items:
                item_counter += 1
                cat_slug = slugify(cat)
                label_slug = safe_filename(it.label or f"item-{item_counter}")
                for j, img in enumerate(it.images, start=1):
                    if not img.abs_path or not img.abs_path.exists():
                        continue
                    notes = it.notes
                    if it.audio_transcripts:
                        notes = (notes + "\n" if notes else "") + " ".join(it.audio_transcripts)
                    overlay_bytes = _overlay_text(img.abs_path, notes, payload.brand_color)
                    fname = f"{item_counter:02d}_{cat_slug}_{label_slug}_{j:02d}.jpg"
                    zf.writestr(fname, overlay_bytes)
                    manifest_rows.append({
                        "filename": fname,
                        "item_uuid": it.client_uuid,
                        "category": it.category,
                        "label": it.label,
                        "notes": it.notes,
                        "voice_notes": " | ".join(it.audio_transcripts),
                        "taken_at": img.taken_at,
                        "image_uuid": img.client_uuid,
                    })

        # manifest.csv
        csv_buf = io.StringIO()
        writer = csv.DictWriter(
            csv_buf,
            fieldnames=["filename", "item_uuid", "category", "label", "notes",
                        "voice_notes", "taken_at", "image_uuid"],
        )
        writer.writeheader()
        for row in manifest_rows:
            writer.writerow(row)
        zf.writestr("manifest.csv", csv_buf.getvalue())

        # README
        readme = (
            f"SiteSnap image dump\n"
            f"===================\n\n"
            f"Site: {payload.site.business_name}\n"
            f"Survey date: {payload.site.survey_date}\n"
            f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n"
            f"Items: {len(payload.items)}\n"
            f"Images: {sum(len(i.images) for i in payload.items)}\n\n"
            f"Each image has the item's notes overlaid in a solid color bar at\n"
            f"the bottom. Filenames sort in survey order:\n"
            f"  NN_category_label_NN.jpg\n\n"
            f"manifest.csv lists every image with its metadata.\n"
        )
        zf.writestr("README.txt", readme)

    filename = f"{site_slug}_{payload.site.survey_date or 'survey'}.zip"
    return buf.getvalue(), filename
