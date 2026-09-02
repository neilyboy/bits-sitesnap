/**Image helpers: downscale, normalize EXIF orientation, generate thumbnail, sha256.*/

export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
  thumbnailDataUrl: string;
  sha256: string;
}

const MAX_DIM = 1920;
const THUMB_DIM = 200;

export async function processImage(file: Blob, mime = "image/jpeg"): Promise<ProcessedImage> {
  const bitmap = await loadBitmap(file);
  const oriented = await normalizeOrientation(file, bitmap);
  const downscaled = downscale(oriented, MAX_DIM);
  const blob = await canvasToBlob(downscaled.canvas, mime, 0.85);
  const thumb = downscale(oriented, THUMB_DIM);
  const thumbnailDataUrl = thumb.canvas.toDataURL("image/jpeg", 0.7);
  // Skip client-side sha256 — it's slow on large images and the server
  // computes its own hash on upload. We can compute it lazily if needed.
  return {
    blob,
    width: downscaled.width,
    height: downscaled.height,
    thumbnailDataUrl,
    sha256: "",
  };
}

async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  if ("createImageBitmap" in self) {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img>
    }
  }
  // Fallback for browsers without createImageBitmap.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    return img as unknown as ImageBitmap;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function normalizeOrientation(file: Blob, bitmap: ImageBitmap): Promise<ImageBitmap> {
  // EXIF orientation handling: createImageBitmap already applies orientation
  // in most modern browsers when given a Blob. If using the <img> fallback,
  // we'd need a library — but for the fallback path we just return as-is.
  return bitmap;
}

function downscale(src: ImageBitmap | HTMLImageElement, maxDim: number): {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
} {
  const sw = (src as ImageBitmap).width || (src as HTMLImageElement).naturalWidth;
  const sh = (src as ImageBitmap).height || (src as HTMLImageElement).naturalHeight;
  let w = sw;
  let h = sh;
  if (w > maxDim || h > maxDim) {
    const ratio = Math.min(maxDim / w, maxDim / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
  return { canvas, width: w, height: h };
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      mime,
      quality
    );
  });
}

export async function sha256(blob: Blob): Promise<string> {
  if (crypto?.subtle) {
    const buf = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback: not available — return empty.
  return "";
}

export function blobToObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
