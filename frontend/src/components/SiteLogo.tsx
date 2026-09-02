import { useEffect, useState } from "react";
import { getSetting } from "../db";

interface SiteLogoProps {
  blob?: Blob;
  url?: string;
  size?: number;
  borderRadius?: number;
}

/**
 * Displays a site logo from either:
 * 1. A Blob stored in IndexedDB (offline-capable)
 * 2. A server URL (fallback when blob is missing)
 */
export default function SiteLogo({ blob, url, size = 48, borderRadius = 10 }: SiteLogoProps) {
  const [objectUrl, setObjectUrl] = useState("");
  const [fetchedUrl, setFetchedUrl] = useState("");

  useEffect(() => {
    if (blob) {
      const u = URL.createObjectURL(blob);
      setObjectUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setObjectUrl("");
  }, [blob]);

  useEffect(() => {
    if (!blob && url) {
      let cancelled = false;
      (async () => {
        try {
          const token = await getSetting("auth_token", "");
          let base = await getSetting("server_url", "");
          base = base ? base.replace(/\/$/, "") : "";
          let effectiveUrl = url;
          if (effectiveUrl.startsWith("http") &&
              (effectiveUrl.includes("://localhost") || effectiveUrl.includes("://127.0.0.1"))) {
            try {
              const u = new URL(effectiveUrl);
              effectiveUrl = u.pathname + u.search;
            } catch {}
          }
          const fullUrl = effectiveUrl.startsWith("http") ? effectiveUrl : (base + effectiveUrl);
          const resp = await fetch(fullUrl, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!resp.ok) return;
          const fetchedBlob = await resp.blob();
          if (!cancelled) {
            setFetchedUrl(URL.createObjectURL(fetchedBlob));
          }
        } catch {}
      })();
      return () => {
        cancelled = true;
        setFetchedUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return ""; });
      };
    }
    setFetchedUrl("");
  }, [blob, url]);

  const src = objectUrl || fetchedUrl;
  if (!src) return null;
  return (
    <img
      src={src}
      alt="Site logo"
      style={{
        width: size, height: size, objectFit: "cover",
        borderRadius, border: "1px solid var(--border)",
        flexShrink: 0,
      }}
    />
  );
}
