"""PDF report generation via WeasyPrint."""
from __future__ import annotations

import io
from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy.orm import Session

from ..config import get_settings
from .data import build_report

_env = Environment(
    loader=FileSystemLoader(Path(__file__).resolve().parent.parent / "templates"),
    autoescape=select_autoescape(["html", "xml"]),
)


def _logo_svg(brand_color: str) -> str:
    """Read the bundled logo SVG and recolor the white fills to brand color."""
    logo_path = Path(__file__).resolve().parent.parent.parent.parent / "logo.svg"
    if not logo_path.exists():
        # Fallback: look in static dir
        logo_path = get_settings().data_dir / "logo.svg"
    if not logo_path.exists():
        return ""
    svg = logo_path.read_text(encoding="utf-8")
    # The source logo uses fill: #fff. Recolor to white-on-brand (keep white)
    # but ensure viewBox sizing. We leave it white since the cover background
    # is the brand color.
    return svg


def generate_pdf(s: Session, site_id: int) -> tuple[bytes, str]:
    payload = build_report(s, site_id, embed_images=False)
    if payload is None:
        raise FileNotFoundError(f"Site {site_id} not found")

    tmpl = _env.get_template("report.html")
    html = tmpl.render(
        site=payload.site,
        items=payload.items,
        categories_in_order=payload.categories_in_order,
        brand_color=payload.brand_color,
        logo_svg=_logo_svg(payload.brand_color),
        generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    )

    # WeasyPrint needs file:// URLs for local images; build_report already
    # sets abs_path and the template uses file:// when data_url is empty.
    from weasyprint import HTML

    pdf_bytes = HTML(string=html, base_url=str(Path.cwd())).write_pdf()
    filename = f"{payload.site.business_name or 'site'}_{payload.site.survey_date or 'survey'}.pdf"
    return pdf_bytes, filename
