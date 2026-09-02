/**
 * Save a photo to the phone's camera roll / photo gallery using the
 * Web Share API. On iOS and Android, this opens the share sheet so
 * the user can pick "Save Image" (iOS) or "Save to Photos" (Android).
 *
 * PWAs cannot silently write to the camera roll — the user must confirm
 * via the share sheet. This is the closest a web app can get.
 *
 * Returns true if the share was successful, false if cancelled or unsupported.
 */
export async function saveToCameraRoll(blob: Blob, filename: string): Promise<boolean> {
  try {
    // Check if Web Share API with file sharing is supported
    if (!navigator.canShare) return false;
    const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
    if (!navigator.canShare({ files: [file] })) return false;
    await navigator.share({
      files: [file],
      title: "Save photo",
    });
    return true;
  } catch (e: any) {
    // User cancelled or share failed
    if (e?.name === "AbortError") return false;
    console.warn("saveToCameraRoll failed:", e);
    return false;
  }
}

/**
 * Check if the device supports sharing files (needed for camera roll save).
 */
export function canSaveToCameraRoll(): boolean {
  return typeof navigator !== "undefined" && !!navigator.canShare;
}
