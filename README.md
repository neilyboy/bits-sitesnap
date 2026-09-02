# SiteSnap

A self-hosted, mobile-first, **offline-capable** PWA for fast Verkada site-survey documentation. Snap photos, dictate notes, sync when you're back online, and export to PDF / HTML / ZIP (with notes overlaid on each image).

Built for technicians who work inside buildings with no cellular signal.

---

## Features

- **Mobile-first PWA** — installable on your phone's home screen, works fully offline.
- **Fast capture flow** — pick a category, snap 1+ photos, dictate or type a note, save. Repeat.
- **Hybrid voice-to-text** — uses the browser's Web Speech API for instant on-device transcription when available; falls back to recording audio for server-side Whisper transcription (GPU-accelerated) when Web Speech is unavailable (e.g., iOS Safari).
- **Offline-first sync** — all data (sites, items, photos, audio, notes) is stored locally in IndexedDB. A sync engine pushes/pulls to the server when connectivity returns (automatic on `online` event + app launch, or manual via the Sync button).
- **Three export formats per site:**
  - **PDF** — cover page (logo, site info, surveyor, date) + summary table + items grouped by category with photos and notes. Print-ready.
  - **HTML** — single self-contained file with embedded images and click-to-zoom lightbox.
  - **ZIP** — every image with its notes overlaid as a solid brand-color bar at the bottom, plus `manifest.csv`. Extract to your network share.
- **PIN auth** — single-user with an argon2-hashed PIN gate + JWT sessions.
- **Default categories** — Cameras, Access Control, Intercom, Air Quality, Alarms, Workplace, Other. Add custom ones in Settings.
- **Docker Compose** — single container with GPU passthrough for Whisper.

---

## Quick Start

### 1. Configure

```bash
cp .env.example config/.env
```

Edit `config/.env` and set:

- **`SITESNAP_PIN_HASH`** — an argon2 hash of your PIN. Generate one:
  ```bash
  docker compose run --rm sitesnap python -m backend.scripts.hash_pin
  ```
  (Enter your PIN twice; copy the `SITESNAP_PIN_HASH=...` line into `config/.env`.)

- **`JWT_SECRET`** — a random 32+ char string:
  ```bash
  python -c "import secrets; print(secrets.token_urlsafe(48))"
  ```

- **`WHISPER_MODEL`** — `small` (default), `tiny`, `base`, `medium`, or `large-v3`. Larger = more accurate, slower.
- **`WHISPER_DEVICE`** — `cuda` (GPU, default) or `cpu`.
- **`BRAND_COLOR`** — hex color for the image overlay bar and PDF accents (default: `#0B1F3A`).

### 2. Build & Run

```bash
docker compose up --build -d
```

The app is available at `http://<server-ip>:8000`.

> **HTTPS is required** for PWA install, camera access, service workers, and the Web Speech API. Put Caddy or nginx in front — see `Caddyfile.example` for a ready-to-use Caddy config with automatic Let's Encrypt.

### 3. Use

1. Open the app in your phone's browser.
2. Enter your PIN to unlock.
3. Tap **+ New Site** → fill in business name, address, contact info → **Start Surveying**.
4. Pick a category (Cameras, Access Control, etc.), tap the 📷 button to snap photos, tap 🎤 to dictate a note (or type), tap **✓ Save Item**.
5. Repeat for each item. All data is saved locally — works offline.
6. When you're back online, tap **Sync now** (or it syncs automatically).
7. From the site detail page, tap **Export** to download PDF / HTML / ZIP.

---

## Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│  Mobile browser (PWA)        │        │  Ubuntu server (Docker Compose)   │
│  - React + Vite              │  HTTPS │  ┌────────────────────────────┐  │
│  - Service Worker (app shell)│ ◀────▶ │  │ FastAPI backend (uvicorn)  │  │
│  - IndexedDB via Dexie       │        │  │  - REST API + sync         │  │
│  - Web Speech API /          │        │  │  - Whisper transcription  │  │
│    MediaRecorder fallback    │        │  │  - PDF (WeasyPrint)        │  │
│  - Background Sync API       │        │  │  - HTML export             │  │
└─────────────────────────────┘        │  │  - ZIP + Pillow overlay   │  │
                                       │  │  - SQLite (volume)        │  │
                                       │  │  - Serves built React SPA │  │
                                       │  └────────────────────────────┘  │
                                       │  Volume: ./data (db + images)    │
                                       │  GPU device passthrough          │
                                       └──────────────────────────────────┘
```

**Stack:**
- Backend: Python 3.12, FastAPI, SQLAlchemy + SQLite, faster-whisper (GPU), WeasyPrint (PDF), Pillow (image overlay), Jinja2 (templates).
- Frontend: React 18 + TypeScript, Vite, vite-plugin-pwa, Dexie (IndexedDB), react-router.
- Infra: Docker Compose, single container, NVIDIA GPU passthrough, local disk volume.

---

## Sync Model

- Every record has a `client_uuid` (UUIDv7, generated on device) and `sync_status` (`pending` | `synced`).
- **Push:** client sends all `pending` records. Server upserts by `client_uuid`.
- **Pull:** client requests records with `server_updated_at > last_sync_at`.
- **Conflict policy:** last-write-wins on `updated_at`. Single-user → negligible conflict risk.
- **Binaries (images/audio):** metadata is synced via push/pull; the actual blobs are uploaded separately to `/api/items/{id}/images` and `/api/items/{id}/audio`.
- **Triggers:** explicit "Sync now" button; automatic on `online` event and app launch.

---

## Exports

### PDF
Cover page (BITS logo, site name, address, contacts, surveyor, date) → summary table (#, Category, Label, Notes preview, Photo count) → items grouped by category with full notes and photos.

### HTML
Same content as PDF, single self-contained `.html` file with images embedded as base64. Click any photo to open a lightbox zoom. Portable — email it, drop it on a share, open in any browser.

### ZIP (image dump for network share)
Every image is re-rendered with the item's notes overlaid in a solid brand-color bar at the bottom of the image. Filenames sort in survey order: `01_cameras_front-door_01.jpg`. Includes:
- `manifest.csv` — filename, item UUID, category, label, notes, voice notes, taken_at, image UUID.
- `README.txt` — summary of the dump.

Extract the ZIP directly to your network share folder.

---

## Backup

The entire application state lives in the `./data` volume:
- `data/sitesnap.db` — SQLite database (sites, items, image/audio metadata, categories).
- `data/images/` — uploaded photos.
- `data/audio/` — uploaded audio clips.

To back up:

```bash
# Hot backup the SQLite database safely
sqlite3 data/sitesnap.db ".backup data/sitesnap-backup.db"

# Or back up the whole data directory
tar czf sitesnap-backup-$(date +%Y%m%d).tar.gz data/
```

For automated backups, add a cron job that runs the above and copies the archive to your backup destination.

---

## Development

### Frontend
```bash
cd frontend
npm install
npm run dev    # http://localhost:5173 (proxies /api to localhost:8000)
npm run build  # outputs to frontend/dist/
```

### Backend
```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .

DATA_DIR=./data SITESNAP_PIN_HASH='...' JWT_SECRET='...' \
  uvicorn backend.app.main:app --reload --port 8000
```

### Generate a PIN hash (local)
```bash
python -m backend.scripts.hash_pin
```

---

## Troubleshooting

**"PIN not configured" on login**
→ `SITESNAP_PIN_HASH` is empty in `config/.env`. Generate a hash with `docker compose run --rm sitesnap python -m backend.scripts.hash_pin` and paste it in.

**Camera doesn't open / PWA won't install**
→ You need HTTPS. Use Caddy (see `Caddyfile.example`) or nginx with a valid certificate. Camera, service workers, and Web Speech API all require a secure context.

**Voice-to-text doesn't work on iPhone**
→ iOS Safari has limited/no Web Speech API support. The app automatically falls back to recording audio, which is transcribed server-side by Whisper after sync. Check the sync status — the transcript will appear once the audio is uploaded and processed.

**Transcription is slow**
→ If you don't have a GPU, set `WHISPER_DEVICE=cpu` and `WHISPER_MODEL=tiny` or `base` in `config/.env`. Restart the container.

**Sync fails / "offline"**
→ Check that the server is reachable and HTTPS is configured. The sync bar shows the error. The app will retry automatically when connectivity returns.

**Photos take up too much space on my phone**
→ Images are downscaled to max 1920px before storing in IndexedDB. A 100-camera survey (~300 photos) is typically under 200MB. You can clear the app's storage from your browser settings after syncing (data is safely on the server).

**Lost my PIN**
→ Regenerate the hash: `docker compose run --rm sitesnap python -m backend.scripts.hash_pin`, update `config/.env`, restart: `docker compose restart`.

---

## Project Structure

```
.
├── Dockerfile                  # Multi-stage: build React, then Python runtime
├── docker-compose.yml          # Single service + GPU passthrough + volumes
├── Caddyfile.example           # Optional HTTPS reverse proxy config
├── pyproject.toml              # Python backend deps
├── .env.example                # Config template
├── logo.svg                    # BITS logo (white on transparent)
├── data/                       # Volume: SQLite db + images + audio (gitignored)
├── config/                     # Volume: .env file (gitignored)
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI app + lifespan + SPA serving
│   │   ├── config.py           # Settings from env
│   │   ├── db.py               # SQLAlchemy engine + sessions
│   │   ├── models.py           # ORM models
│   │   ├── schemas.py          # Pydantic DTOs
│   │   ├── auth.py             # PIN + JWT + rate limiting
│   │   ├── routes.py           # All API endpoints
│   │   ├── sync.py             # Sync engine (push/pull, UUID upsert)
│   │   ├── transcribe.py       # Whisper worker (asyncio loop)
│   │   ├── seed.py             # Default categories + DB init
│   │   ├── util.py             # slugify, safe_filename
│   │   ├── exports/
│   │   │   ├── data.py         # Build report payload
│   │   │   ├── pdf.py          # WeasyPrint PDF
│   │   │   ├── html.py         # Standalone HTML
│   │   │   └── zip.py          # ZIP + Pillow text overlay
│   │   └── templates/
│   │       └── report.html     # Jinja2 template (PDF + HTML)
│   └── scripts/
│       └── hash_pin.py         # PIN hashing CLI
└── frontend/
    ├── package.json
    ├── vite.config.ts          # Vite + PWA plugin
    ├── index.html
    ├── public/
    │   ├── logo.svg            # Recolored logo for PWA
    │   └── manifest.webmanifest
    └── src/
        ├── main.tsx            # Entry + routing + auth gate
        ├── App.tsx             # App shell + sync bar
        ├── theme.css           # Mobile-first styles
        ├── db.ts               # Dexie (IndexedDB) schema
        ├── lib/
        │   ├── api.ts          # HTTP client
        │   ├── sync.ts         # Sync engine (push/pull/binaries)
        │   ├── image.ts        # Downscale + thumbnail + sha256
        │   └── types.ts        # TypeScript DTOs
        ├── hooks/
        │   ├── useSpeechRecognition.ts
        │   └── useAudioRecorder.ts
        └── pages/
            ├── LoginPage.tsx
            ├── SitesPage.tsx
            ├── SiteFormPage.tsx
            ├── SiteDetailPage.tsx
            ├── SurveyPage.tsx   # The fast capture workflow
            ├── ExportPage.tsx
            └── SettingsPage.tsx
```

---

## License

Private. Built for BITS internal use.
