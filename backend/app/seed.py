"""Seed default categories and create DB schema on startup."""
from __future__ import annotations

from sqlalchemy import select

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
    _seed_categories()


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
