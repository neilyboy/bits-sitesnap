"""FastAPI application entrypoint for SiteSnap."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routes import router
from .seed import init_db
from .transcribe import worker_loop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("sitesnap")

_transcribe_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _transcribe_task
    log.info("SiteSnap starting up.")
    init_db()
    # Start the transcription worker (will load Whisper lazily on first job).
    _transcribe_task = asyncio.create_task(worker_loop(), name="transcribe-worker")
    try:
        yield
    finally:
        if _transcribe_task:
            _transcribe_task.cancel()
            try:
                await _transcribe_task
            except asyncio.CancelledError:
                pass
        log.info("SiteSnap shutting down.")


settings = get_settings()

app = FastAPI(
    title="SiteSnap",
    version="0.1.0",
    description="Offline-first site survey tool for Verkada installs.",
    lifespan=lifespan,
)

# CORS (only if explicitly configured; default same-origin).
if settings.cors_origin:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origin.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(router)

# Serve the built React SPA from / (frontend/dist), if present.
_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if not _dist.exists():
    # Inside the Docker image the dist is copied to ./frontend/dist relative to /app.
    _dist = Path("/app/frontend/dist")

if _dist.exists():
    # SPA fallback: serve index.html for non-API, non-file routes.
    from fastapi.responses import FileResponse

    @app.get("/", include_in_schema=False)
    def _spa_root():
        return FileResponse(_dist / "index.html")

    # Mount static assets (js, css, images) at /assets etc.
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    # Catch-all for SPA routes (anything not under /api).
    @app.get("/{full_path:path}", include_in_schema=False)
    def _spa_catch(full_path: str):
        if full_path.startswith("api/"):
            return {"detail": "Not Found"}
        candidate = _dist / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
else:
    log.warning("Frontend dist not found at %s. Serving API only.", _dist)
