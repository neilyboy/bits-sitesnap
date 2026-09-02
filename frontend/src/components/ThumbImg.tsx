import { useEffect, useState } from "react";

interface ThumbImgProps {
  blob?: Blob;
  dataUrl?: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}

/**
 * Displays a thumbnail from either a stored data URL or a Blob.
 * Properly manages object URLs (creates once, revokes on unmount/change)
 * to avoid the memory leak and render issues that come from calling
 * URL.createObjectURL directly in JSX.
 */
export default function ThumbImg({ blob, dataUrl, alt, className, onClick }: ThumbImgProps) {
  const [objectUrl, setObjectUrl] = useState<string>("");

  useEffect(() => {
    // Prefer the stored data URL (small thumbnail, no allocation needed).
    if (dataUrl) {
      setObjectUrl("");
      return;
    }
    // Fall back to creating an object URL from the blob.
    if (blob) {
      const url = URL.createObjectURL(blob);
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setObjectUrl("");
  }, [blob, dataUrl]);

  const src = dataUrl || objectUrl;
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
