import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, type ImageRow, type ItemRow } from "../db";
import { useEffect, useMemo, useRef, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { processImage, quickThumbnail } from "../lib/image";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import ThumbImg from "../components/ThumbImg";
import ImageViewer from "../components/ImageViewer";
import { saveToCameraRoll } from "../lib/share";
import { IconChevronLeft, IconCamera, IconMic, IconCheck, IconX, IconEdit, IconTrash, IconPlus } from "../components/Icons";

const DEFAULT_CATEGORIES = ["Cameras", "Access Control", "Intercom", "Air Quality", "Alarms", "Workplace", "Other"];

export default function SurveyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const site = useLiveQuery(() => (id ? db.sites.get(id) : undefined), [id]);
  const items = useLiveQuery(
    () => db.items.where("site_client_uuid").equals(id ?? "").reverse().sortBy("sort_order"),
    [id]
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeCategory, setActiveCategory] = useState("Cameras");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<{ blob: Blob; thumb: string; uuid: string }[]>([]);
  const [processingPhotos, setProcessingPhotos] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [toast, setToast] = useState("");
  const [viewerBlob, setViewerBlob] = useState<Blob | undefined>(undefined);
  const [viewerAlt, setViewerAlt] = useState("");
  const [viewerSaveUuid, setViewerSaveUuid] = useState<string | null>(null);
  const [viewerServerUrl, setViewerServerUrl] = useState<string | null>(null);

  const speech = useSpeechRecognition();
  const recorder = useAudioRecorder();

  const categories = useLiveQuery(() => db.categories.orderBy("sort_order").toArray(), []);
  const catNames = useMemo(() => {
    const names = (categories ?? []).map((c) => c.name);
    return names.length ? names : DEFAULT_CATEGORIES;
  }, [categories]);

  // When speech produces a final transcript (listening stopped with text),
  // append it to notes. This fires once when the user taps Stop.
  useEffect(() => {
    if (!speech.listening && speech.transcript) {
      setNotes((n) => (n ? n + " " : "") + speech.transcript.trim());
      speech.reset();
    }
  }, [speech.listening, speech.transcript]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 1800);
  }

  function openViewer(blob: Blob | undefined, alt: string, imgUuid?: string, serverUrl?: string) {
    setViewerBlob(blob);
    setViewerAlt(alt);
    setViewerSaveUuid(imgUuid ?? null);
    setViewerServerUrl(serverUrl ?? null);
  }

  async function saveAnnotatedImage(annotatedBlob: Blob) {
    if (!viewerSaveUuid) return;
    const now = new Date().toISOString();
    // Generate a new thumbnail from the annotated image.
    let newThumb = "";
    try { newThumb = await quickThumbnail(annotatedBlob); } catch {}
    await db.images.update(viewerSaveUuid, {
      blob: annotatedBlob,
      thumbnail_data_url: newThumb,
      updated_at: now,
      sync_status: "pending",
      binary_synced: false,
    });
    // Mark parent item as updated too.
    const img = await db.images.get(viewerSaveUuid);
    if (img) {
      await db.items.update(img.item_client_uuid, { updated_at: now, sync_status: "pending" });
    }
    showToast("Annotated image saved");
  }

  async function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    setProcessingPhotos(true);

    // Check if camera roll save is enabled
    const saveToGallery = await getSetting("save_to_gallery", "0");

    try {
      for (const file of files) {
        const uuid = uuidv7();
        // Show a quick thumbnail immediately for instant feedback.
        let quickThumb = "";
        try {
          quickThumb = await quickThumbnail(file);
        } catch {}
        setPendingPhotos((p) => [...p, {
          blob: file,  // temporary — replaced after processing
          thumb: quickThumb,
          uuid,
        }]);
        // Process the full image in the background (downscale + better thumb).
        // This doesn't block the UI — the user can add more photos, type notes, etc.
        processImage(file, file.type || "image/jpeg").then((processed) => {
          setPendingPhotos((p) =>
            p.map((ph) => ph.uuid === uuid ? {
              ...ph,
              blob: processed.blob,
              thumb: processed.thumbnailDataUrl,
            } : ph)
          );
        }).catch((err) => {
          console.error("Photo processing failed:", err);
        });

        // Also save to camera roll if enabled (Web Share API)
        if (saveToGallery === "1") {
          // Don't await — we don't want to block the capture flow
          saveToCameraRoll(file, `${site?.business_name || "SiteSnap"}_${uuid}.jpg`).then((ok) => {
            if (!ok) showToast("Could not save to camera roll");
          });
        }
      }
      showToast(`${files.length} photo${files.length > 1 ? "s" : ""} added`);
    } catch (err) {
      console.error("Photo add failed:", err);
      showToast("Photo add failed");
    } finally {
      setProcessingPhotos(false);
    }
  }

  async function saveItem() {
    if (!site) return;
    if (pendingPhotos.length === 0 && !notes.trim() && !label.trim()) {
      showToast("Add a photo, label, or note first");
      return;
    }
    // Wait for any photos still processing in the background.
    // Check if any pending photo's blob is still the raw File (not yet processed).
    const stillProcessing = pendingPhotos.some((p) => p.blob instanceof File);
    if (stillProcessing) {
      showToast("Processing photos — try again in a moment");
      return;
    }
    setSavingItem(true);
    try {
      const now = new Date().toISOString();
      const itemUuid = uuidv7();
      const sortOrder = (items?.[0]?.sort_order ?? 0) + 1;
      const item: ItemRow = {
        client_uuid: itemUuid,
        site_client_uuid: site.client_uuid,
        category: activeCategory,
        label: label.trim(),
        notes: notes.trim(),
        sort_order: sortOrder,
        created_at: now,
        updated_at: now,
        sync_status: "pending",
        deleted: false,
      };
      await db.items.add(item);

      for (let i = 0; i < pendingPhotos.length; i++) {
        const p = pendingPhotos[i];
        const img: ImageRow = {
          client_uuid: p.uuid,
          item_client_uuid: itemUuid,
          blob: p.blob,
          thumbnail_data_url: p.thumb,
          filename: `${p.uuid}.jpg`,
          mime: "image/jpeg",
          width: 0,
          height: 0,
          taken_at: now,
          sha256: "",
          sort_order: i,
          created_at: now,
          updated_at: now,
          sync_status: "pending",
          deleted: false,
          binary_synced: false,
        };
        await db.images.add(img);
      }

      // Reset for next item.
      setPendingPhotos([]);
      setLabel("");
      setNotes("");
      showToast("Item saved");
    } finally {
      setSavingItem(false);
    }
  }

  async function stopAndSaveAudio() {
    const result = await recorder.stop();
    if (!result || !site) return;
    // No Web Speech transcript — store audio clip for server transcription.
    const now = new Date().toISOString();
    const audioUuid = uuidv7();
    // We need an item to attach the audio to. If none exists yet, create a
    // placeholder item with the current category/label.
    let itemUuid = items?.find((i) => !i.deleted && i.category === activeCategory)?.client_uuid;
    if (!itemUuid) {
      itemUuid = uuidv7();
      const sortOrder = (items?.[0]?.sort_order ?? 0) + 1;
      await db.items.add({
        client_uuid: itemUuid,
        site_client_uuid: site.client_uuid,
        category: activeCategory,
        label: label.trim(),
        notes: "",
        sort_order: sortOrder,
        created_at: now,
        updated_at: now,
        sync_status: "pending",
        deleted: false,
      });
    }
    await db.audio.add({
      client_uuid: audioUuid,
      item_client_uuid: itemUuid,
      blob: result.blob,
      duration_sec: result.durationSec,
      transcript_text: "",
      transcript_status: "pending",
      transcript_error: "",
      created_at: now,
      updated_at: now,
      sync_status: "pending",
      deleted: false,
      binary_synced: false,
    });
    showToast("Voice note saved — will transcribe on sync");
  }

  function toggleRecording() {
    if (recorder.recording) {
      stopAndSaveAudio();
    } else if (speech.listening) {
      speech.stop();
    } else {
      // Prefer Web Speech for instant results; fall back to MediaRecorder.
      if (speech.supported) {
        speech.start();
      } else {
        recorder.start();
      }
    }
  }

  if (!site) return <div className="empty">Loading…</div>;
  const visibleItems = (items ?? []).filter((i) => !i.deleted);

  // The textarea shows notes + live interim transcript (read-only overlay).
  // The interim text is NOT stored in notes — it's just for live display.
  const displayNotes = notes + (speech.interimTranscript ? " " + speech.interimTranscript : "");

  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <Link to={`/sites/${site.client_uuid}`} className="btn btn-ghost">‹ Done</Link>
        <strong style={{ fontSize: 15 }}>{site.business_name}</strong>
        <span className="small muted">{visibleItems.length}</span>
      </div>

      {/* Category chips */}
      <div className="category-chips">
        {catNames.map((c) => (
          <button
            key={c}
            className={`chip ${activeCategory === c ? "active" : ""}`}
            onClick={() => setActiveCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Pending photos preview */}
      {pendingPhotos.length > 0 && (
        <div className="item-card">
          <div className="row between">
            <strong>New item · {pendingPhotos.length} photo{pendingPhotos.length > 1 ? "s" : ""}</strong>
            <button className="btn btn-ghost btn-danger" style={{ padding: "4px 8px" }} onClick={() => setPendingPhotos([])}>Clear</button>
          </div>
          {processingPhotos && (
            <div className="small muted" style={{ marginBottom: 4 }}>Processing photos…</div>
          )}
          <div className="thumbs">
            {pendingPhotos.map((p) => (
              <img key={p.uuid} src={p.thumb} alt="pending" />
            ))}
          </div>
        </div>
      )}

      {/* Label + notes */}
      <div className="field">
        <label>Label / Location (optional)</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`e.g. Front door, Camera 12`} />
      </div>
      <div className="field">
        <label>Notes {speech.listening && <span className="muted tiny">(listening…)</span>}</label>
        <textarea
          value={displayNotes}
          onChange={(e) => {
            // Only update notes from the typed portion, not the interim overlay.
            // If speech is listening, ignore manual edits (the interim text
            // would get captured). If not listening, the display == notes.
            if (!speech.listening) {
              setNotes(e.target.value);
            }
          }}
          readOnly={speech.listening}
          placeholder="Tap the mic to dictate, or type notes here…"
        />
      </div>

      {/* Action buttons */}
      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <button
          className={`btn ${speech.listening || recorder.recording ? "btn-danger" : "btn-primary"}`}
          onClick={toggleRecording}
          style={{ flex: 1 }}
        >
          {speech.listening || recorder.recording ? (<><IconX size={18} /> Stop</>) : (<><IconMic size={18} /> Voice</>)}
        </button>
        <button className="btn btn-primary" onClick={saveItem} disabled={savingItem} style={{ flex: 1 }}>
          {savingItem ? (<><span className="spinner" /> Saving…</>) : (<><IconCheck size={18} /> Save Item</>)}
        </button>
      </div>
      {speech.error && <div className="small" style={{ color: "var(--danger)", marginBottom: 8 }}>{speech.error}</div>}
      {recorder.error && <div className="small" style={{ color: "var(--danger)", marginBottom: 8 }}>{recorder.error}</div>}
      {!speech.supported && !recorder.recording && (
        <div className="small muted" style={{ marginBottom: 8 }}>
          Voice-to-text not supported on this browser — recording audio for server transcription.
        </div>
      )}

      {/* Existing items list */}
      <h3 style={{ fontSize: 15, color: "var(--brand)", margin: "16px 0 6px" }}>Items ({visibleItems.length})</h3>
      {visibleItems.map((it) => (
        <ItemRowCard key={it.client_uuid} item={it} openViewer={openViewer} />
      ))}

      {/* Floating capture button */}
      <button
        className="capture-fab"
        onClick={() => fileInputRef.current?.click()}
        disabled={savingItem}
        title="Take photo"
      >
        <IconCamera size={28} />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden-file"
        onChange={onFilesChosen}
      />

      {toast && <div className="toast">{toast}</div>}

      {(viewerBlob || viewerServerUrl) && (
        <ImageViewer
          blob={viewerBlob}
          serverUrl={viewerServerUrl ?? undefined}
          alt={viewerAlt}
          onClose={() => { setViewerBlob(undefined); setViewerSaveUuid(null); setViewerServerUrl(null); }}
          onSave={saveAnnotatedImage}
        />
      )}
    </div>
  );
}

function ItemRowCard({ item, openViewer }: { item: ItemRow; openViewer: (blob: Blob | undefined, alt: string, imgUuid?: string, serverUrl?: string) => void }) {
  const images = useLiveQuery(
    () => db.images.where("item_client_uuid").equals(item.client_uuid).reverse().sortBy("sort_order"),
    [item.client_uuid]
  );
  const audio = useLiveQuery(
    () => db.audio.where("item_client_uuid").equals(item.client_uuid).toArray(),
    [item.client_uuid]
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(item.label);
  const [editNotes, setEditNotes] = useState(item.notes);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const editFileRef = useRef<HTMLInputElement>(null);

  const visibleImgs = (images ?? []).filter((i) => !i.deleted);
  const transcripts = (audio ?? []).filter((a) => !a.deleted && a.transcript_text).map((a) => a.transcript_text);

  // Sync edit state when item changes.
  useEffect(() => {
    if (!editing) {
      setEditLabel(item.label);
      setEditNotes(item.notes);
    }
  }, [item.label, item.notes, editing]);

  async function saveEdit() {
    const now = new Date().toISOString();
    await db.items.update(item.client_uuid, {
      label: editLabel.trim(),
      notes: editNotes.trim(),
      updated_at: now,
      sync_status: "pending",
    });
    setEditing(false);
  }

  function cancelEdit() {
    setEditLabel(item.label);
    setEditNotes(item.notes);
    setEditing(false);
  }

  async function deleteItem() {
    if (!confirm(`Delete "${item.label || "this item"}"?`)) return;
    const now = new Date().toISOString();
    await db.items.update(item.client_uuid, { deleted: true, updated_at: now, sync_status: "pending" });
  }

  async function deleteImage(imgUuid: string) {
    const now = new Date().toISOString();
    await db.images.update(imgUuid, { deleted: true, updated_at: now, sync_status: "pending" });
    // Also mark the parent item as updated so it re-syncs.
    await db.items.update(item.client_uuid, { updated_at: now, sync_status: "pending" });
  }

  async function onAddPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (editFileRef.current) editFileRef.current.value = "";
    setAddingPhotos(true);
    try {
      const now = new Date().toISOString();
      const existingCount = visibleImgs.length;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const uuid = uuidv7();
        // Quick thumbnail for instant display.
        let quickThumb = "";
        try { quickThumb = await quickThumbnail(file); } catch {}
        const img: ImageRow = {
          client_uuid: uuid,
          item_client_uuid: item.client_uuid,
          blob: file,
          thumbnail_data_url: quickThumb,
          filename: `${uuid}.jpg`,
          mime: file.type || "image/jpeg",
          width: 0,
          height: 0,
          taken_at: now,
          sha256: "",
          sort_order: existingCount + i,
          created_at: now,
          updated_at: now,
          sync_status: "pending",
          deleted: false,
          binary_synced: false,
        };
        await db.images.add(img);
        // Process in background.
        processImage(file, file.type || "image/jpeg").then((processed) => {
          db.images.update(uuid, {
            blob: processed.blob,
            thumbnail_data_url: processed.thumbnailDataUrl,
            width: processed.width,
            height: processed.height,
          });
        }).catch((err) => console.error("Photo processing failed:", err));
      }
      // Mark item as updated.
      await db.items.update(item.client_uuid, { updated_at: now, sync_status: "pending" });
    } finally {
      setAddingPhotos(false);
    }
  }

  if (editing) {
    return (
      <div className="item-card" onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="badge badge-cat">{item.category}</span>
          <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 13 }} onClick={cancelEdit}><IconX size={16} /> Cancel</button>
        </div>
        <div className="field">
          <label>Label / Location</label>
          <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="e.g. Front door, Camera 12" />
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Notes…" />
        </div>
        {/* Photos in edit mode — show with delete buttons */}
        {visibleImgs.length > 0 && (
          <div className="thumbs" style={{ marginBottom: 8 }}>
            {visibleImgs.map((img) => (
              <div key={img.client_uuid} style={{ position: "relative" }}>
                <ThumbImg blob={img.blob} dataUrl={img.thumbnail_data_url} serverUrl={img.server_url} alt={item.label} onClick={() => openViewer(img.blob, item.label, img.client_uuid, img.server_url)} />
                <button
                  className="btn btn-danger"
                  style={{ position: "absolute", top: -4, right: -4, padding: "2px 6px", fontSize: 12, borderRadius: "50%", minWidth: 24 }}
                  onClick={(e) => { e.stopPropagation(); deleteImage(img.client_uuid); }}
                  title="Remove photo"
                ><IconX size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <button
            className="btn btn-ghost"
            onClick={() => editFileRef.current?.click()}
            disabled={addingPhotos}
            style={{ flex: 1 }}
          >
            {addingPhotos ? "Adding…" : (<><IconCamera size={18} /> Add Photos</>)}
          </button>
          <input
            ref={editFileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden-file"
            onChange={onAddPhotos}
          />
          <button className="btn btn-primary" onClick={saveEdit} style={{ flex: 1 }}><IconCheck size={18} /> Save</button>
        </div>
        <button className="btn btn-danger btn-block" onClick={deleteItem}><IconTrash size={16} /> Delete item</button>
      </div>
    );
  }

  return (
    <div className="item-card" onClick={() => setOpen(!open)}>
      <div className="row between">
        <div>
          <span className="badge badge-cat">{item.category}</span>{" "}
          <strong>{item.label || "Untitled"}</strong>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {item.sync_status === "pending" && <span className="badge badge-pending">pending</span>}
          <button
            className="btn btn-ghost"
            style={{ padding: "2px 8px", fontSize: 13 }}
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            title="Edit item"
          ><IconEdit size={16} /></button>
        </div>
      </div>
      {(item.notes || transcripts.length > 0) && (
        <div className="notes-preview">
          {item.notes}
          {transcripts.map((t, i) => (
            <div key={i} className="small muted" style={{ marginTop: 4 }}>🎤 {t}</div>
          ))}
        </div>
      )}
      {visibleImgs.length > 0 && (
        <div className="thumbs">
          {visibleImgs.slice(0, open ? visibleImgs.length : 4).map((img) => (
            <ThumbImg
              key={img.client_uuid}
              blob={img.blob}
              dataUrl={img.thumbnail_data_url}
              serverUrl={img.server_url}
              alt={item.label}
              onClick={() => openViewer(img.blob, item.label, img.client_uuid, img.server_url)}
            />
          ))}
        </div>
      )}
      {open && visibleImgs.length > 4 && (
        <div className="small muted" style={{ marginTop: 4 }}>{visibleImgs.length} photos total</div>
      )}
    </div>
  );
}
