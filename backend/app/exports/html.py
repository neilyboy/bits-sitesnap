"""Standalone HTML report (self-contained, images embedded as base64)."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy.orm import Session

from .data import build_report
from .pdf import _logo_svg

_env = Environment(
    loader=FileSystemLoader(Path(__file__).resolve().parent.parent / "templates"),
    autoescape=select_autoescape(["html", "xml"]),
)


def generate_html(s: Session, site_id: int) -> tuple[bytes, str]:
    payload = build_report(s, site_id, embed_images=True)
    if payload is None:
        raise FileNotFoundError(f"Site {site_id} not found")

    tmpl = _env.get_template("report.html")
    html = tmpl.render(
        site=payload.site,
        items=payload.items,
        categories_in_order=payload.categories_in_order,
        brand_color=payload.brand_color,
        logo_svg=_logo_svg(payload.brand_color, dark=True),
        site_logo_data_url=payload.logo_data_url,
        generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    )

    filename = f"{payload.site.business_name or 'site'}_{payload.site.survey_date or 'survey'}.html"
    return html.encode("utf-8"), filename
