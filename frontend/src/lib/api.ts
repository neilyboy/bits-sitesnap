import { getSetting } from "../db";
import type {
  CategoryDTO,
  SiteDTO,
  SyncPullResponse,
  SyncPushPayload,
  SyncPushResponse,
  TokenDTO,
} from "./types";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function baseUrl(): Promise<string> {
  const custom = await getSetting("server_url", "");
  if (custom) return custom.replace(/\/$/, "");
  // Same-origin by default (the FastAPI server serves the SPA in production).
  return "";
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getSetting("auth_token", "");
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
  expectBlob = false
): Promise<T> {
  const base = await baseUrl();
  const url = `${base}${path}`;
  const headers = new Headers(opts.headers);
  const auth = await authHeaders();
  for (const [k, v] of Object.entries(auth)) headers.set(k, v);
  if (opts.body && !(opts.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  if (expectBlob) return (await res.blob()) as unknown as T;
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export const api = {
  ApiError,

  async health(): Promise<boolean> {
    try {
      const base = await baseUrl();
      await fetch(`${base}/api/health`);
      return true;
    } catch {
      return false;
    }
  },

  async login(pin: string): Promise<TokenDTO> {
    return request<TokenDTO>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ pin }),
    });
  },

  async changePin(oldPin: string, newPin: string): Promise<TokenDTO> {
    return request<TokenDTO>("/api/auth/change-pin", {
      method: "POST",
      body: JSON.stringify({ old_pin: oldPin, new_pin: newPin }),
    });
  },

  async listCategories(): Promise<CategoryDTO[]> {
    return request<CategoryDTO[]>("/api/categories");
  },

  async addCategory(name: string, sortOrder: number): Promise<CategoryDTO> {
    return request<CategoryDTO>("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name, sort_order: sortOrder }),
    });
  },

  async listSites(): Promise<SiteDTO[]> {
    return request<SiteDTO[]>("/api/sites");
  },

  async push(payload: SyncPushPayload): Promise<SyncPushResponse> {
    return request<SyncPushResponse>("/api/sync/push", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async pull(lastSyncAt: string | null): Promise<SyncPullResponse> {
    return request<SyncPullResponse>("/api/sync/pull", {
      method: "POST",
      body: JSON.stringify({ last_sync_at: lastSyncAt }),
    });
  },

  async uploadImage(itemId: number, fields: {
    file: Blob;
    clientUuid: string;
    filename: string;
    takenAt: string;
    sortOrder: number;
  }): Promise<unknown> {
    const fd = new FormData();
    fd.append("file", fields.file, fields.filename);
    fd.append("client_uuid", fields.clientUuid);
    fd.append("filename", fields.filename);
    fd.append("taken_at", fields.takenAt);
    fd.append("sort_order", String(fields.sortOrder));
    return request(`/api/items/${itemId}/images`, { method: "POST", body: fd });
  },

  async uploadSiteLogo(siteId: number, file: Blob): Promise<unknown> {
    const fd = new FormData();
    const ext = file.type === "image/png" ? "png" : "jpg";
    fd.append("file", file, `logo.${ext}`);
    return request(`/api/sites/${siteId}/logo`, { method: "POST", body: fd });
  },

  async uploadAudio(itemId: number, fields: {
    file: Blob;
    clientUuid: string;
    filename: string;
    durationSec: number;
    transcriptText: string;
  }): Promise<unknown> {
    const fd = new FormData();
    fd.append("file", fields.file, fields.filename);
    fd.append("client_uuid", fields.clientUuid);
    fd.append("duration_sec", String(fields.durationSec));
    fd.append("transcript_text", fields.transcriptText);
    return request(`/api/items/${itemId}/audio`, { method: "POST", body: fd });
  },

  async retranscribe(audioId: number): Promise<unknown> {
    return request(`/api/audio/${audioId}/retranscribe`, { method: "POST" });
  },

  async exportPdf(siteId: number): Promise<Blob> {
    return request<Blob>(`/api/sites/${siteId}/export/pdf`, { method: "POST" }, true);
  },

  async exportHtml(siteId: number): Promise<Blob> {
    return request<Blob>(`/api/sites/${siteId}/export/html`, { method: "POST" }, true);
  },

  async exportZip(siteId: number): Promise<Blob> {
    return request<Blob>(`/api/sites/${siteId}/export/zip`, { method: "POST" }, true);
  },
};
