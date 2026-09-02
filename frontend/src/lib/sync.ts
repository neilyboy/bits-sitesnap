import { api } from "./api";
import {
  AudioRow,
  ImageRow,
  ItemRow,
  SiteRow,
  db,
  getSetting,
  logSync,
  setSetting,
  _registerAutoSyncScheduler,
} from "../db";
import type {
  AudioMetaDTO,
  ImageMetaDTO,
  ItemInDTO,
  SiteInDTO,
  SyncPushPayload,
} from "./types";

let syncing = false;
let lastError = "";
const listeners = new Set<() => void>();

// ---- Auto-sync ----
let autoSyncEnabled = true;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let consecutiveFailures = 0;
const DEBOUNCE_MS = 3000;        // wait 3s after last change before syncing
const PERIODIC_INTERVAL_MS = 60000; // check every 60s as a safety net
const MAX_BACKOFF_MS = 5 * 60 * 1000; // max 5 min backoff

export function subscribeSync(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

export function isSyncing() {
  return syncing;
}

export function getLastError() {
  return lastError;
}

/**
 * Schedule a debounced auto-sync. Call this after any local change
 * (site/item/image create/update/delete). The sync will fire after
 * DEBOUNCE_MS of inactivity, and only if online + authenticated.
 */
export function scheduleAutoSync(): void {
  if (!autoSyncEnabled) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void autoSync();
  }, DEBOUNCE_MS);
}

/**
 * Internal auto-sync — checks preconditions and backs off on failure.
 */
async function autoSync(): Promise<void> {
  if (syncing) return;
  if (!navigator.onLine) return;
  // Check if there's anything to sync
  try {
    const count = await pendingCount();
    if (count.total === 0) return;
  } catch {
    return;
  }
  // Check if authenticated
  const token = await getSetting("auth_token", "");
  if (!token) return;

  const result = await syncNow();
  if (result.ok) {
    consecutiveFailures = 0;
  } else {
    consecutiveFailures++;
    // Exponential backoff: schedule a retry after increasing delay
    const backoff = Math.min(
      MAX_BACKOFF_MS,
      Math.pow(2, consecutiveFailures) * 5000
    );
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void autoSync();
    }, backoff);
  }
}

/**
 * Start the periodic sync timer and online event listener.
 * Call once at app startup.
 */
export function initAutoSync(): void {
  // Periodic safety-net sync
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = setInterval(() => {
    void autoSync();
  }, PERIODIC_INTERVAL_MS);

  // Sync when coming back online
  window.addEventListener("online", () => {
    void autoSync();
  });

  // Sync when the page becomes visible again (user returned to tab)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void autoSync();
    }
  });
}

export function setAutoSyncEnabled(enabled: boolean): void {
  autoSyncEnabled = enabled;
  if (!enabled && debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export function isAutoSyncEnabled(): boolean {
  return autoSyncEnabled;
}

// Register our scheduler with the DB hooks so any create/update/delete
// on sites/items/images/audio triggers a debounced auto-sync.
_registerAutoSyncScheduler(scheduleAutoSync);

export async function pendingCount(): Promise<{
  sites: number;
  items: number;
  images: number;
  audio: number;
  total: number;
}> {
  const [sites, items, images, audio] = await Promise.all([
    db.sites.where("sync_status").equals("pending").count(),
    db.items.where("sync_status").equals("pending").count(),
    db.images.where("sync_status").equals("pending").count(),
    db.audio.where("sync_status").equals("pending").count(),
  ]);
  // Also count binaries not yet uploaded (boolean field — can't use index).
  const unsyncedImages = (await db.images.toArray()).filter((i) => !i.binary_synced).length;
  const unsyncedAudio = (await db.audio.toArray()).filter((a) => !a.binary_synced).length;
  const unsyncedBinaries = unsyncedImages + unsyncedAudio;
  return {
    sites,
    items,
    images,
    audio,
    total: sites + items + images + audio + unsyncedBinaries,
  };
}

export async function syncNow(): Promise<{ ok: boolean; detail: string }> {
  if (syncing) return { ok: false, detail: "already syncing" };
  if (!navigator.onLine) {
    lastError = "offline";
    notify();
    return { ok: false, detail: "offline" };
  }
  syncing = true;
  lastError = "";
  notify();
  try {
    const pushResult = await push();
    const pullResult = await pull();
    await setSetting("last_sync_at", pullResult.server_time);
    await logSync("push", `sites:${pushResult.sites} items:${pushResult.items} images:${pushResult.images} audio:${pushResult.audio}`, true);
    await logSync("pull", `sites:${pullResult.sites} items:${pullResult.items} images:${pullResult.images} audio:${pullResult.audio}`, true);
    notify();
    return { ok: true, detail: "synced" };
  } catch (e: any) {
    lastError = e?.message ?? String(e);
    await logSync("push", `error: ${lastError}`, false);
    notify();
    return { ok: false, detail: lastError };
  } finally {
    syncing = false;
    notify();
  }
}

async function push(): Promise<{ sites: number; items: number; images: number; audio: number }> {
  const pendingSites = await db.sites.where("sync_status").equals("pending").toArray();
  const pendingItems = await db.items.where("sync_status").equals("pending").toArray();
  const pendingImageMetas = await db.images.where("sync_status").equals("pending").toArray();
  const pendingAudioMetas = await db.audio.where("sync_status").equals("pending").toArray();

  const payload: SyncPushPayload = {
    sites: pendingSites.map(siteToDto),
    items: pendingItems.map(itemToDto),
    image_metas: pendingImageMetas.map(imageMetaToDto),
    audio_metas: pendingAudioMetas.map(audioMetaToDto),
  };

  if (payload.sites.length === 0 && payload.items.length === 0
      && payload.image_metas.length === 0 && payload.audio_metas.length === 0) {
    return { sites: 0, items: 0, images: 0, audio: 0 };
  }

  const resp = await api.push(payload);

  // Update local rows with server ids + timestamps.
  await db.transaction("rw", db.sites, db.items, db.images, db.audio, async () => {
    for (const s of resp.sites) {
      await db.sites.update(s.client_uuid, {
        id: s.id,
        server_updated_at: s.server_updated_at,
        sync_status: "synced",
        deleted: s.deleted,
        logo_url: s.logo_url || undefined,
      });
    }
    for (const i of resp.items) {
      await db.items.update(i.client_uuid, {
        id: i.id,
        server_updated_at: i.server_updated_at,
        sync_status: "synced",
        deleted: i.deleted,
      });
    }
    for (const img of resp.images) {
      await db.images.update(img.client_uuid, {
        id: img.id,
        server_updated_at: img.server_updated_at,
        sync_status: "synced",
        deleted: img.deleted,
      });
    }
    for (const a of resp.audio) {
      await db.audio.update(a.client_uuid, {
        id: a.id,
        server_updated_at: a.server_updated_at,
        sync_status: "synced",
        deleted: a.deleted,
      });
    }
  });

  // Upload binaries (images + audio) for rows that now have a server item id.
  await uploadBinaries();

  return {
    sites: resp.sites.length,
    items: resp.items.length,
    images: resp.images.length,
    audio: resp.audio.length,
  };
}

async function uploadBinaries(): Promise<void> {
  // Upload site logos that haven't been synced yet
  const sitesWithLogos = (await db.sites.toArray()).filter(
    (s) => s.logo_blob && !s.logo_synced && !s.deleted && s.id
  );
  for (const site of sitesWithLogos) {
    try {
      await api.uploadSiteLogo(site.id!, site.logo_blob!);
      await db.sites.update(site.client_uuid, { logo_synced: true });
    } catch (e) {
      console.warn("logo upload failed", site.client_uuid, e);
      throw e;
    }
  }

  // Images whose metadata is synced but blob not yet uploaded (boolean — filter in memory).
  const images = (await db.images.toArray()).filter((i) => !i.binary_synced);
  for (const img of images) {
    if (img.deleted) {
      await db.images.update(img.client_uuid, { binary_synced: true });
      continue;
    }
    const item = await db.items.get(img.item_client_uuid);
    if (!item || !item.id || item.deleted) continue;
    if (!img.blob) {
      // No blob to upload (e.g., image was pulled from server without binary).
      await db.images.update(img.client_uuid, { binary_synced: true });
      continue;
    }
    try {
      await api.uploadImage(item.id, {
        file: img.blob,
        clientUuid: img.client_uuid,
        filename: img.filename,
        takenAt: img.taken_at,
        sortOrder: img.sort_order,
      });
      await db.images.update(img.client_uuid, { binary_synced: true });
    } catch (e) {
      // Will retry next sync.
      console.warn("image upload failed", img.client_uuid, e);
      throw e;
    }
  }

  const audio = (await db.audio.toArray()).filter((a) => !a.binary_synced);
  for (const a of audio) {
    if (a.deleted) {
      await db.audio.update(a.client_uuid, { binary_synced: true });
      continue;
    }
    const item = await db.items.get(a.item_client_uuid);
    if (!item || !item.id || item.deleted) continue;
    if (!a.blob) {
      // No binary to upload (e.g., transcript came from Web Speech).
      await db.audio.update(a.client_uuid, { binary_synced: true });
      continue;
    }
    try {
      await api.uploadAudio(item.id, {
        file: a.blob,
        clientUuid: a.client_uuid,
        filename: `${a.client_uuid}.webm`,
        durationSec: a.duration_sec,
        transcriptText: a.transcript_text,
      });
      await db.audio.update(a.client_uuid, { binary_synced: true });
    } catch (e) {
      console.warn("audio upload failed", a.client_uuid, e);
      throw e;
    }
  }
}

async function pull(): Promise<{ server_time: string; sites: number; items: number; images: number; audio: number }> {
  const lastSyncAt = await getSetting("last_sync_at", "");
  const resp = await api.pull(lastSyncAt || null);

  await db.transaction("rw", db.sites, db.items, db.images, db.audio, db.categories, async () => {
    // Build server_id -> client_uuid maps so children can resolve their parents.
    const siteIdToUuid = new Map<number, string>();
    const itemIdToUuid = new Map<number, string>();

    for (const s of resp.sites) {
      siteIdToUuid.set(s.id, s.client_uuid);
      const existing = await db.sites.get(s.client_uuid);
      if (existing && existing.server_updated_at
          && existing.server_updated_at >= s.server_updated_at
          && existing.sync_status === "synced") {
        // skip — we already have this or newer, but update logo_url if server has one
        if (s.logo_url && !existing.logo_url) {
          await db.sites.update(s.client_uuid, { logo_url: s.logo_url, logo_synced: true });
        }
      } else if (existing && existing.sync_status === "pending") {
        if (!existing.server_updated_at || existing.server_updated_at < s.server_updated_at) {
          // Server is newer — update, but preserve local logo_blob if we have one
          const logoBlob = existing.logo_blob;
          await db.sites.put({ ...existing, ...siteFromDto(s), logo_blob: logoBlob });
        }
      } else {
        await db.sites.put(siteFromDto(s));
      }
    }
    // Also include already-known sites in the map (for items whose site wasn't in this pull).
    const allSites = await db.sites.toArray();
    for (const s of allSites) if (s.id) siteIdToUuid.set(s.id, s.client_uuid);

    for (const i of resp.items) {
      itemIdToUuid.set(i.id, i.client_uuid);
      const existing = await db.items.get(i.client_uuid);
      if (existing && existing.sync_status === "pending"
          && existing.server_updated_at && existing.server_updated_at >= i.server_updated_at) {
        continue;
      }
      const siteUuid = siteIdToUuid.get(i.site_id) ?? existing?.site_client_uuid ?? "";
      await db.items.put({ ...itemFromDto(i), site_client_uuid: siteUuid });
    }
    const allItems = await db.items.toArray();
    for (const it of allItems) if (it.id) itemIdToUuid.set(it.id, it.client_uuid);

    for (const img of resp.images) {
      const existing = await db.images.get(img.client_uuid);
      if (existing && existing.blob) {
        // We have the blob locally — just update metadata, keep the blob.
        await db.images.update(img.client_uuid, {
          id: img.id,
          server_updated_at: img.server_updated_at,
          sync_status: "synced",
          deleted: img.deleted,
          binary_synced: true,
          server_url: img.url,
        });
      } else if (existing && !existing.blob) {
        // We have the row but no blob — update metadata + server_url.
        await db.images.update(img.client_uuid, {
          id: img.id,
          server_updated_at: img.server_updated_at,
          sync_status: "synced",
          deleted: img.deleted,
          binary_synced: true,
          server_url: img.url,
        });
      } else if (!existing) {
        // New image from server — no blob, but store the server_url for fetching.
        const itemUuid = itemIdToUuid.get(img.item_id) ?? "";
        await db.images.put({ ...imageFromDto(img), item_client_uuid: itemUuid });
      }
    }
    for (const a of resp.audio) {
      const existing = await db.audio.get(a.client_uuid);
      if (existing) {
        await db.audio.update(a.client_uuid, {
          id: a.id,
          transcript_text: a.transcript_text || existing.transcript_text,
          transcript_status: (a.transcript_status as any) || existing.transcript_status,
          transcript_error: a.transcript_error,
          server_updated_at: a.server_updated_at,
          sync_status: "synced",
          deleted: a.deleted,
          binary_synced: true,
        });
      } else {
        const itemUuid = itemIdToUuid.get(a.item_id) ?? "";
        await db.audio.put({ ...audioFromDto(a), item_client_uuid: itemUuid });
      }
    }
    for (const c of resp.categories) {
      await db.categories.put({
        id: c.id,
        name: c.name,
        slug: c.slug,
        sort_order: c.sort_order,
        is_default: c.is_default,
      });
    }
  });

  return {
    server_time: resp.server_time,
    sites: resp.sites.length,
    items: resp.items.length,
    images: resp.images.length,
    audio: resp.audio.length,
  };
}

// ---------- mappers ----------
function siteToDto(s: SiteRow): SiteInDTO {
  return {
    client_uuid: s.client_uuid,
    business_name: s.business_name,
    address_line1: s.address_line1,
    address_line2: s.address_line2,
    city: s.city,
    state: s.state,
    zip: s.zip,
    contact_name: s.contact_name,
    contact_phone: s.contact_phone,
    contact_email: s.contact_email,
    surveyor_name: s.surveyor_name,
    survey_date: s.survey_date,
    general_notes: s.general_notes,
    deleted: s.deleted,
  };
}

function itemToDto(i: ItemRow): ItemInDTO {
  return {
    client_uuid: i.client_uuid,
    site_client_uuid: i.site_client_uuid,
    category: i.category,
    label: i.label,
    notes: i.notes,
    sort_order: i.sort_order,
    deleted: i.deleted,
  };
}

function imageMetaToDto(img: ImageRow): ImageMetaDTO {
  return {
    client_uuid: img.client_uuid,
    item_client_uuid: img.item_client_uuid,
    filename: img.filename,
    mime: img.mime,
    width: img.width,
    height: img.height,
    taken_at: img.taken_at,
    sha256: img.sha256,
    sort_order: img.sort_order,
    deleted: img.deleted,
  };
}

function audioMetaToDto(a: AudioRow): AudioMetaDTO {
  return {
    client_uuid: a.client_uuid,
    item_client_uuid: a.item_client_uuid,
    duration_sec: a.duration_sec,
    transcript_text: a.transcript_text,
    transcript_status: a.transcript_status,
    deleted: a.deleted,
  };
}

function siteFromDto(s: import("./types").SiteDTO): SiteRow {
  return {
    id: s.id,
    client_uuid: s.client_uuid,
    business_name: s.business_name,
    address_line1: s.address_line1,
    address_line2: s.address_line2,
    city: s.city,
    state: s.state,
    zip: s.zip,
    contact_name: s.contact_name,
    contact_phone: s.contact_phone,
    contact_email: s.contact_email,
    surveyor_name: s.surveyor_name,
    survey_date: s.survey_date,
    general_notes: s.general_notes,
    created_at: s.created_at,
    updated_at: s.updated_at,
    server_updated_at: s.server_updated_at,
    sync_status: "synced",
    deleted: s.deleted,
    logo_url: s.logo_url || undefined,
    logo_synced: true, // if server has a logo_url, it's already synced
  };
}

function itemFromDto(i: import("./types").ItemDTO): ItemRow {
  return {
    id: i.id,
    client_uuid: i.client_uuid,
    site_client_uuid: "", // not in DTO; resolved via site_id at pull time
    category: i.category,
    label: i.label,
    notes: i.notes,
    sort_order: i.sort_order,
    created_at: i.created_at,
    updated_at: i.updated_at,
    server_updated_at: i.server_updated_at,
    sync_status: "synced",
    deleted: i.deleted,
  };
}

function imageFromDto(img: import("./types").ImageDTO): ImageRow {
  return {
    id: img.id,
    client_uuid: img.client_uuid,
    item_client_uuid: "", // resolved separately
    blob: undefined,
    server_url: img.url, // server path to fetch the image binary
    filename: img.filename,
    mime: img.mime,
    width: img.width,
    height: img.height,
    taken_at: img.taken_at,
    sha256: img.sha256,
    sort_order: img.sort_order,
    created_at: img.created_at,
    updated_at: img.updated_at,
    server_updated_at: img.server_updated_at,
    sync_status: "synced",
    deleted: img.deleted,
    binary_synced: true,
  };
}

function audioFromDto(a: import("./types").AudioDTO): AudioRow {
  return {
    id: a.id,
    client_uuid: a.client_uuid,
    item_client_uuid: "",
    duration_sec: a.duration_sec,
    transcript_text: a.transcript_text,
    transcript_status: a.transcript_status as any,
    transcript_error: a.transcript_error,
    created_at: a.created_at,
    updated_at: a.updated_at,
    server_updated_at: a.server_updated_at,
    sync_status: "synced",
    deleted: a.deleted,
    binary_synced: true,
  };
}
