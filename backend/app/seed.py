"""Seed default categories and create DB schema on startup."""
from __future__ import annotations

from sqlalchemy import inspect, select, text

from .db import engine, session_scope
from .models import Base, Category
from .util import slugify

DEFAULT_CATEGORIES = [
    "Cameras",
    "Access Control",
    "Intercom",
    "Air Quality",
    "Alarms",
    "Workplace",
    "Other",
]


def init_db() -> None:
    Base.metadata.create_all(engine)
    _migrate_add_columns()
    _seed_categories()


def _migrate_add_columns() -> None:
    """Add new columns to existing tables (SQLite ALTER TABLE ADD COLUMN)."""
    inspector = inspect(engine)
    # Sites: add logo_path if missing
    site_cols = {c["name"] for c in inspector.get_columns("sites")}
    if "logo_path" not in site_cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE sites ADD COLUMN logo_path VARCHAR(255) DEFAULT ''"))


def _seed_categories() -> None:
    with session_scope() as s:
        existing = {row.slug for row in s.scalars(select(Category)).all()}
        for i, name in enumerate(DEFAULT_CATEGORIES):
            slug = slugify(name)
            if slug in existing:
                continue
            s.add(Category(name=name, slug=slug, sort_order=i, is_default=True))


def list_categories() -> list[Category]:
    with session_scope() as s:
        return list(s.scalars(select(Category).order_by(Category.sort_order, Category.id)).all())
