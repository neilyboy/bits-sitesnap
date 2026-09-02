import Dexie, { Table } from "dexie";

export interface SiteRow {
  id?: number; // server id, undefined until synced
  client_uuid: string;
  business_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  surveyor_name: string;
  survey_date: string;
  general_notes: string;
  created_at: string;
  updated_at: string;
  server_updated_at?: string;
  sync_status: "pending" | "synced";
  deleted: boolean;
  // Site logo / company image
  logo_blob?: Blob;       // stored in IndexedDB (offline-capable)
  logo_url?: string;      // server path to fetch logo if blob is missing
  logo_synced: boolean;   // whether logo binary has been uploaded
}

export interface ItemRow {
  id?: number;
  client_uuid: string;
  site_client_uuid: string;
  category: string;
  label: string;
  notes: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  server_updated_at?: string;
  sync_status: "pending" | "synced";
  deleted: boolean;
}

export interface ImageRow {
  id?: number;
  client_uuid: string;
  item_client_uuid: string;
  // Blob stored in IndexedDB (offline). May be missing for images pulled
  // from the server (created on another device). In that case, use server_url
  // to fetch the image on-demand.
  blob?: Blob;
  thumbnail_data_url?: string; // small data URL for fast list rendering
  server_url?: string; // server path to fetch the image if blob is missing
  filename: string;
  mime: string;
  width: number;
  height: number;
  taken_at: string;
  sha256: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  server_updated_at?: string;
  sync_status: "pending" | "synced";
  deleted: boolean;
  // Track whether the binary has been uploaded to the server.
  binary_synced: boolean;
}

export interface AudioRow {
  id?: number;
  client_uuid: string;
  item_client_uuid: string;
  blob?: Blob; // present until uploaded
  duration_sec: number;
  transcript_text: string;
  transcript_status: "pending" | "done" | "failed";
  transcript_error: string;
  created_at: string;
  updated_at: string;
  server_updated_at?: string;
  sync_status: "pending" | "synced";
  deleted: boolean;
  binary_synced: boolean;
}

export interface CategoryRow {
  id?: number;
  name: string;
  slug: string;
  sort_order: number;
  is_default: boolean;
}

export interface SyncLogRow {
  id?: number;
  at: string;
  direction: "push" | "pull";
  detail: string;
  ok: boolean;
}

export interface SettingRow {
  key: string;
  value: string;
}

class SiteSnapDB extends Dexie {
  sites!: Table<SiteRow, string>;
  items!: Table<ItemRow, string>;
  images!: Table<ImageRow, string>;
  audio!: Table<AudioRow, string>;
  categories!: Table<CategoryRow, string>;
  sync_log!: Table<SyncLogRow, number>;
  settings!: Table<SettingRow, string>;

  constructor() {
    super("sitesnap");
    this.version(1).stores({
      sites: "client_uuid, sync_status, deleted, server_updated_at, survey_date",
      items: "client_uuid, site_client_uuid, sync_status, deleted, server_updated_at, sort_order",
      images: "client_uuid, item_client_uuid, sync_status, deleted, binary_synced, sort_order",
      audio: "client_uuid, item_client_uuid, sync_status, deleted, binary_synced",
      categories: "slug, sort_order",
      sync_log: "++id, at",
      settings: "key",
    });
    // v2: Remove boolean indexes (deleted, binary_synced) — IndexedDB
    // cannot index boolean values. We filter in memory instead.
    this.version(2).stores({
      sites: "client_uuid, sync_status, server_updated_at, survey_date",
      items: "client_uuid, site_client_uuid, sync_status, server_updated_at, sort_order",
      images: "client_uuid, item_client_uuid, sync_status, sort_order",
      audio: "client_uuid, item_client_uuid, sync_status",
      categories: "slug, sort_order",
      sync_log: "++id, at",
      settings: "key",
    });
    // v3: Add logo fields to sites (no index changes needed — Dexie
    // preserves existing data and just adds the new fields as undefined).
    this.version(3).stores({
      sites: "client_uuid, sync_status, server_updated_at, survey_date",
      items: "client_uuid, site_client_uuid, sync_status, server_updated_at, sort_order",
      images: "client_uuid, item_client_uuid, sync_status, sort_order",
      audio: "client_uuid, item_client_uuid, sync_status",
      categories: "slug, sort_order",
      sync_log: "++id, at",
      settings: "key",
    });
  }
}

export const db = new SiteSnapDB();

// ---- Auto-sync scheduling ----
// After any create/update/delete on syncable tables, schedule a debounced
// auto-sync. The actual sync logic lives in sync.ts and checks online
// status, auth, etc. before firing.
let _scheduleAutoSync: (() => void) | null = null;

/** Called by sync.ts to register its auto-sync scheduler. */
export function _registerAutoSyncScheduler(fn: () => void): void {
  _scheduleAutoSync = fn;
}

function _hookAutoSync() {
  if (_scheduleAutoSync) _scheduleAutoSync();
}

// Register Dexie hooks on all syncable tables
for (const table of ["sites", "items", "images", "audio"] as const) {
  db[table].hook("creating", _hookAutoSync);
  db[table].hook("updating", _hookAutoSync);
  db[table].hook("deleting", _hookAutoSync);
}

// ---- Setting helpers ----
export async function getSetting(key: string, fallback = ""): Promise<string> {
  const row = await db.settings.get(key);
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}

export async function logSync(direction: "push" | "pull", detail: string, ok: boolean): Promise<void> {
  await db.sync_log.add({
    at: new Date().toISOString(),
    direction,
    detail,
    ok,
  });
  // Keep last 100 entries.
  const count = await db.sync_log.count();
  if (count > 100) {
    const oldest = await db.sync_log.orderBy("at").limit(count - 100).primaryKeys();
    await db.sync_log.bulkDelete(oldest);
  }
}
