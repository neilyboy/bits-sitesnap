"""Small shared utilities."""
from __future__ import annotations

import re
import unicodedata


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^\w\s-]", "", value).strip().lower()
    return re.sub(r"[-\s]+", "-", value) or "item"


def safe_filename(label: str, max_len: int = 60) -> str:
    s = re.sub(r"[^\w\- ]", "", label).strip().replace(" ", "-")
    return (s[:max_len] or "untitled").lower()
