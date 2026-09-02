import { useEffect, useState } from "react";
import { getSetting } from "../db";

interface ThumbImgProps {
  blob?: Blob;
  dataUrl?: string;
  serverUrl?: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}

/**
 * Displays a thumbnail from either:
 * 1. A stored data URL (small thumbnail, fastest)
 * 2. A Blob stored in IndexedDB (offline-capable)
 * 3. A server URL (fallback when blob is missing — e.g., image created
 *    on another device and pulled via sync)
 *
 * Properly manages object URLs (creates once, revokes on unmount/change).
 */
export default function ThumbImg({ blob, dataUrl, serverUrl, alt, className, onClick }: ThumbImgProps) {
  const [objectUrl, setObjectUrl] = useState<string>("");
  const [fetchedUrl, setFetchedUrl] = useState<string>("");
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "error">("idle");

  // Create object URL from blob (or revoke when blob changes).
  useEffect(() => {
    if (blob) {
      const url = URL.createObjectURL(blob);
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setObjectUrl("");
  }, [blob]);

  // If no blob and no dataUrl, try fetching from the server.
  useEffect(() => {
    if (!blob && !dataUrl && serverUrl) {
      let cancelled = false;
      setFetchState("loading");
      (async () => {
        try {
          const token = await getSetting("auth_token", "");
          let base = await getSetting("server_url", "");
          base = base ? base.replace(/\/$/, "") : ""; // strip trailing slash like api.ts
          // Fix old stale URLs that contain localhost/127.0.0.1 — extract
          // just the path so the fetch goes to the configured server, not
          // to the phone's own localhost.
          let effectiveServerUrl = serverUrl;
          if (effectiveServerUrl.startsWith("http") &&
              (effectiveServerUrl.includes("://localhost") || effectiveServerUrl.includes("://127.0.0.1"))) {
            try {
              const u = new URL(effectiveServerUrl);
              effectiveServerUrl = u.pathname + u.search;
            } catch {}
          }
          const fullUrl = effectiveServerUrl.startsWith("http") ? effectiveServerUrl : (base + effectiveServerUrl);
          console.debug("[ThumbImg] fetching", fullUrl);
          const resp = await fetch(fullUrl, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!resp.ok) {
            console.warn("[ThumbImg] fetch failed:", resp.status, resp.statusText, fullUrl);
            if (!cancelled) setFetchState("error");
            return;
          }
          const fetchedBlob = await resp.blob();
          if (!cancelled) {
            const url = URL.createObjectURL(fetchedBlob);
            setFetchedUrl(url);
            setFetchState("idle");
          }
        } catch (e) {
          console.warn("[ThumbImg] fetch error:", e, serverUrl);
          if (!cancelled) setFetchState("error");
        }
      })();
      return () => {
        cancelled = true;
        setFetchedUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return "";
        });
      };
    }
    setFetchState("idle");
  }, [blob, dataUrl, serverUrl]);

  const src = dataUrl || objectUrl || fetchedUrl;

  if (!src) {
    if (fetchState === "loading") {
      return (
        <div
          className={className}
          onClick={onClick}
          style={{
            width: 76, height: 76,
            borderRadius: 6,
            background: "var(--surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid var(--border)",
            ...(onClick ? { cursor: "pointer" } : {}),
          }}
        >
          <span className="spinner dark" />
        </div>
      );
    }
    if (fetchState === "error") {
      return (
        <div
          className={className}
          onClick={onClick}
          style={{
            width: 76, height: 76,
            borderRadius: 6,
            background: "var(--surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            fontSize: 11,
            ...(onClick ? { cursor: "pointer" } : {}),
          }}
        >
          No image
        </div>
      );
    }
    return null;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      style={onClick ? { cursor: "pointer" } : undefined}
    />
  );
}
