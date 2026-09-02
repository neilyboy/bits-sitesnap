# syntax=docker/dockerfile:1

# ---------- Stage 1: build the React PWA ----------
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Build-time public env (VITE_*) can be injected via build args if needed.
RUN npm run build

# ---------- Stage 2: Python runtime ----------
FROM python:3.12-slim-bookworm AS runtime

# System deps for WeasyPrint (cairo, pango, gdk-pixbuf, libffi) and image work.
# nvidia-cuda-toolkit is intentionally NOT installed here; faster-whisper uses
# the host CUDA runtime via the nvidia-container-toolkit passthrough.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libcairo2 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libgdk-pixbuf2.0-0 \
        libffi-dev \
        shared-mime-info \
        fonts-dejavu-core \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend source and pyproject, then install.
COPY pyproject.toml ./
COPY backend/ ./backend/
COPY logo.svg ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

# Copy built frontend into a location FastAPI will serve as static.
COPY --from=frontend-build /build/frontend/dist ./frontend/dist

# Default data dir inside the container (mounted as a volume).
ENV DATA_DIR=/app/data \
    HOST=0.0.0.0 \
    PORT=8000 \
    PYTHONUNBUFFERED=1

EXPOSE 8000

# Run uvicorn from the project root so `backend.app.main:app` resolves.
CMD ["sh", "-c", "uvicorn backend.app.main:app --host ${HOST} --port ${PORT} --workers ${WORKERS:-1}"]
