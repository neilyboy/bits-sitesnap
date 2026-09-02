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
      (async () => {
        try {
          const token = await getSetting("auth_token", "");
          const base = await getSetting("server_url", "");
          const fullUrl = serverUrl.startsWith("http") ? serverUrl : (base + serverUrl);
          const resp = await fetch(fullUrl, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!resp.ok) return;
          const fetchedBlob = await resp.blob();
          if (!cancelled) {
            const url = URL.createObjectURL(fetchedBlob);
            setFetchedUrl(url);
          }
        } catch {
          // Offline or auth failed — can't fetch.
        }
      })();
      return () => {
        cancelled = true;
        if (fetchedUrl) URL.revokeObjectURL(fetchedUrl);
        setFetchedUrl("");
      };
    }
    setFetchedUrl("");
  }, [blob, dataUrl, serverUrl]);

  const src = dataUrl || objectUrl || fetchedUrl;
  if (!src) return null;
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
