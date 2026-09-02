"""Application configuration loaded from environment / .env files."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


def _config_env_path() -> Optional[Path]:
    """Look for a .env file in a few well-known locations."""
    candidates = [
        Path(os.environ.get("SITESNAP_ENV", "")),  # explicit override
        Path("/app/config/.env"),                  # docker volume mount
        Path.cwd() / "config" / ".env",
        Path.cwd() / ".env",
    ]
    for c in candidates:
        if c and c.is_file():
            return c
    return None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_config_env_path()) if _config_env_path() else None,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Auth
    sitesnap_pin_hash: str = ""
    jwt_secret: str = ""
    jwt_ttl_days: int = 30

    # Whisper
    whisper_model: str = "small"
    whisper_device: str = "cuda"
    whisper_compute_type: str = ""

    # Storage
    data_dir: str = "/app/data"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    workers: int = 1

    # Misc
    brand_color: str = "#0B1F3A"
    cors_origin: str = ""

    @property
    def db_path(self) -> Path:
        p = Path(self.data_dir) / "sitesnap.db"
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def images_dir(self) -> Path:
        p = Path(self.data_dir) / "images"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def audio_dir(self) -> Path:
        p = Path(self.data_dir) / "audio"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def exports_dir(self) -> Path:
        p = Path(self.data_dir) / "exports"
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache
def get_settings() -> Settings:
    return Settings()
