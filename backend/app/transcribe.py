"""Background transcription worker using faster-whisper.

A single asyncio task runs the worker loop. It pulls TranscriptionJob rows
in `queued` status, transcribes the corresponding AudioClip, and writes the
result back. Whisper model is loaded lazily on first job (so the server boots
fast and so CPU-only deployments don't pay the cost unless needed).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select, update

from .config import get_settings
from .db import SessionLocal
from .models import AudioClip, TranscriptionJob

log = logging.getLogger("sitesnap.transcribe")

_model = None  # cached faster-whisper model
_model_lock = asyncio.Lock()


def _load_model():
    global _model
    if _model is not None:
        return _model
    from faster_whisper import WhisperModel  # imported lazily

    settings = get_settings()
    compute_type = settings.whisper_compute_type or None
    log.info("Loading Whisper model=%s device=%s compute_type=%s",
             settings.whisper_model, settings.whisper_device, compute_type or "default")
    _model = WhisperModel(
        settings.whisper_model,
        device=settings.whisper_device,
        compute_type=compute_type,
    )
    return _model


async def _transcribe_one(audio: AudioClip, audio_path: Path) -> str:
    """Run Whisper transcription in a thread (it's CPU/GPU-bound, sync)."""
    def _do() -> str:
        model = _load_model()
        segments, _info = model.transcribe(str(audio_path), vad_filter=True)
        return " ".join(seg.text.strip() for seg in segments).strip()

    return await asyncio.to_thread(_do)


async def worker_loop() -> None:
    log.info("Transcription worker started.")
    while True:
        try:
            await _process_next()
        except asyncio.CancelledError:
            log.info("Transcription worker cancelled.")
            raise
        except Exception:
            log.exception("Transcription worker iteration failed.")
        await asyncio.sleep(2.0)


async def _process_next() -> None:
    # Claim the oldest queued job atomically (single-worker, single-process).
    with SessionLocal() as s:
        job = s.scalars(
            select(TranscriptionJob)
            .where(TranscriptionJob.status == "queued")
            .order_by(TranscriptionJob.queued_at)
            .limit(1)
        ).first()
        if job is None:
            return
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        s.commit()
        job_id = job.id
        audio_id = job.audio_id

    # Transcribe outside the DB session.
    with SessionLocal() as s:
        audio = s.get(AudioClip, audio_id)
        if audio is None or audio.transcript_status == "done":
            # Already done (client provided text) or audio gone — finalize job.
            s.execute(
                update(TranscriptionJob)
                .where(TranscriptionJob.id == job_id)
                .values(status="done", finished_at=datetime.now(timezone.utc))
            )
            s.commit()
            return

        settings = get_settings()
        audio_path = settings.audio_dir / audio.file_path if audio.file_path else None
        if not audio_path or not audio_path.exists():
            err = f"Audio file missing: {audio_path}"
            log.error(err)
            audio.transcript_status = "failed"
            audio.transcript_error = err
            s.execute(
                update(TranscriptionJob)
                .where(TranscriptionJob.id == job_id)
                .values(status="failed", error=err, finished_at=datetime.now(timezone.utc))
            )
            s.commit()
            return

        try:
            text = await _transcribe_one(audio, audio_path)
            audio.transcript_text = text
            audio.transcript_status = "done"
            audio.transcript_error = ""
            s.execute(
                update(TranscriptionJob)
                .where(TranscriptionJob.id == job_id)
                .values(status="done", finished_at=datetime.now(timezone.utc))
            )
            s.commit()
            log.info("Transcribed audio_id=%s: %r", audio_id, text[:80])
        except Exception as e:
            log.exception("Transcription failed for audio_id=%s", audio_id)
            audio.transcript_status = "failed"
            audio.transcript_error = str(e)
            s.execute(
                update(TranscriptionJob)
                .where(TranscriptionJob.id == job_id)
                .values(status="failed", error=str(e), finished_at=datetime.now(timezone.utc))
            )
            s.commit()


def enqueue(audio_id: int) -> None:
    """Insert a transcription job row."""
    with SessionLocal() as s:
        s.add(TranscriptionJob(audio_id=audio_id, status="queued"))
        s.commit()
