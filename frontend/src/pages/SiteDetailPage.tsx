import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type ImageRow, type ItemRow } from "../db";
import { useEffect, useRef, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { processImage, quickThumbnail } from "../lib/image";
import ThumbImg from "../components/ThumbImg";
import ImageViewer from "../components/ImageViewer";
import { IconChevronLeft, IconPlus, IconEdit, IconDownload, IconTrash, IconCamera, IconCheck, IconX, IconMapPin, IconUser, IconCalendar, IconChevronDown } from "../components/Icons";
import SiteLogo from "../components/SiteLogo";

const DEFAULT_ORDER = ["Cameras", "Access Control", "Intercom", "Air Quality", "Alarms", "Workplace", "Other"];

function catKey(c: string): [number, string] {
  const i = DEFAULT_ORDER.indexOf(c);
  return [i === -1 ? DEFAULT_ORDER.length : i, c];
}

export default function SiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const site = useLiveQuery(() => (id ? db.sites.get(id) : undefined), [id]);
  const items = useLiveQuery(
    () => db.items.where("site_client_uuid").equals(id ?? "").reverse().sortBy("sort_order"),
    [id]
  );
  const images = useLiveQuery(
    () => db.images.where("item_client_uuid").anyOf((items ?? []).map((i) => i.client_uuid)).toArray(),
    [items]
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [viewerBlob, setViewerBlob] = useState<Blob | undefined>(undefined);
  const [viewerAlt, setViewerAlt] = useState("");
  const [viewerSaveUuid, setViewerSaveUuid] = useState<string | null>(null);
  const [viewerServerUrl, setViewerServerUrl] = useState<string | null>(null);
  const [toast, setToast] = useState("");

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
    let newThumb = "";
    try { newThumb = await quickThumbnail(annotatedBlob); } catch {}
    await db.images.update(viewerSaveUuid, {
      blob: annotatedBlob,
      thumbnail_data_url: newThumb,
      updated_at: now,
      sync_status: "pending",
      binary_synced: false,
    });
    const img = await db.images.get(viewerSaveUuid);
    if (img) {
      await db.items.update(img.item_client_uuid, { updated_at: now, sync_status: "pending" });
    }
    showToast("Annotated image saved");
  }

  if (!site) return <div className="empty">Loading…</div>;

  const visibleItems = (items ?? []).filter((i) => !i.deleted);
  const byCat = new Map<string, typeof visibleItems>();
  for (const it of visibleItems) {
    const arr = byCat.get(it.category) ?? [];
    arr.push(it);
    byCat.set(it.category, arr);
  }
  const cats = [...byCat.keys()].sort((a, b) => {
    const [ai, ax] = catKey(a);
    const [bi, bx] = catKey(b);
    return ai - bi || ax.localeCompare(bx);
  });

  const imgByItem = new Map<string, typeof images>();
  for (const img of images ?? []) {
    if (img.deleted) continue;
    const arr = imgByItem.get(img.item_client_uuid) ?? [];
    arr.push(img);
    imgByItem.set(img.item_client_uuid, arr);
  }

  async function deleteSite() {
    if (!site || !confirm(`Delete site "${site.business_name}"? This will permanently remove the site and all its items and photos (after sync).`)) return;
    const now = new Date().toISOString();
    await db.sites.update(site.client_uuid, { deleted: true, updated_at: now, sync_status: "pending" });
    const siteItems = await db.items.where("site_client_uuid").equals(site.client_uuid).toArray();
    for (const it of siteItems) {
      await db.items.update(it.client_uuid, { deleted: true, updated_at: now, sync_status: "pending" });
      const itemImages = await db.images.where("item_client_uuid").equals(it.client_uuid).toArray();
      for (const img of itemImages) {
        await db.images.update(img.client_uuid, { deleted: true, updated_at: now, sync_status: "pending" });
      }
    }
    navigate("/");
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <Link to="/" className="btn btn-ghost" style={{ padding: "6px 10px" }}>
          <IconChevronLeft size={20} />
          Sites
        </Link>
      </div>

      <div className="card">
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{site.business_name || "Untitled"}</h2>
            {site.sync_status === "pending" && <span className="badge badge-pending" style={{ marginTop: 6 }}>pending</span>}
          </div>
          {(site.logo_blob || site.logo_url) && (
            <SiteLogo blob={site.logo_blob} url={site.logo_url} size={64} />
          )}
        </div>
        <div className="site-meta" style={{ marginTop: 8 }}>
          <IconCalendar size={14} />
          <span>{site.survey_date || "no date"}</span>
        </div>
        {site.address_line1 && (
          <div className="site-meta">
            <IconMapPin size={14} />
            <span>{site.address_line1}{site.address_line2 ? `, ${site.address_line2}` : ""}</span>
          </div>
        )}
        {(site.city || site.state || site.zip) && (
          <div className="site-meta">
            <IconMapPin size={14} style={{ opacity: 0 }} />
            <span>{site.city}{site.city && site.state ? ", " : ""}{site.state} {site.zip}</span>
          </div>
        )}
        {site.contact_name && (
          <div className="site-meta">
            <IconUser size={14} />
            <span>{site.contact_name} {site.contact_phone ? `· ${site.contact_phone}` : ""}</span>
          </div>
        )}
        {site.surveyor_name && (
          <div className="site-meta">
            <IconUser size={14} />
            <span>Surveyor: {site.surveyor_name}</span>
          </div>
        )}
        {site.general_notes && <div className="small" style={{ marginTop: 10, whiteSpace: "pre-wrap", color: "var(--text-secondary)" }}>{site.general_notes}</div>}

        <div className="row" style={{ marginTop: 16, flexWrap: "wrap" }}>
          <Link to={`/sites/${site.client_uuid}/survey`} className="btn btn-primary">
            <IconPlus size={18} />
            Add Items
          </Link>
          <Link to={`/sites/${id}/edit`} className="btn">
            <IconEdit size={16} />
            Edit
          </Link>
          <Link to={`/sites/${id}/export`} className="btn">
            <IconDownload size={16} />
            Export
          </Link>
          <button className="btn btn-danger" onClick={deleteSite}>
            <IconTrash size={16} />
          </button>
        </div>
      </div>

      {visibleItems.length === 0 ? (
        <div className="empty">
          <div className="big"><IconCamera size={48} /></div>
          <div>No items yet.</div>
          <Link to={`/sites/${site.client_uuid}/survey`} className="btn btn-primary" style={{ marginTop: 16 }}>
            <IconPlus size={18} />
            Start Surveying
          </Link>
        </div>
      ) : (
        cats.map((cat) => (
          <div key={cat}>
            <div className="section-header">
              {cat} <span style={{ opacity: 0.5 }}>({byCat.get(cat)!.length})</span>
            </div>
            {byCat.get(cat)!.map((it) => {
              const imgs = imgByItem.get(it.client_uuid) ?? [];
              const isOpen = expanded === it.client_uuid;
              const isEditing = editingItem === it.client_uuid;
              return (
                <ItemDisplay
                  key={it.client_uuid}
                  item={it}
                  imgs={imgs}
                  isOpen={isOpen}
                  isEditing={isEditing}
                  onToggle={() => setExpanded(isOpen ? null : it.client_uuid)}
                  onEdit={() => { setEditingItem(it.client_uuid); setExpanded(it.client_uuid); }}
                  onCancelEdit={() => setEditingItem(null)}
                  openViewer={openViewer}
                />
              );
            })}
          </div>
        ))
      )}

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

function ItemDisplay({
  item,
  imgs,
  isOpen,
  isEditing,
  onToggle,
  onEdit,
  onCancelEdit,
  openViewer,
}: {
  item: ItemRow;
  imgs: ImageRow[];
  isOpen: boolean;
  isEditing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  openViewer: (blob: Blob | undefined, alt: string, imgUuid?: string, serverUrl?: string) => void;
}) {
  const [editLabel, setEditLabel] = useState(item.label);
  const [editNotes, setEditNotes] = useState(item.notes);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const editFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setEditLabel(item.label);
      setEditNotes(item.notes);
    }
  }, [item.label, item.notes, isEditing]);

  const visibleImgs = imgs.filter((i) => !i.deleted);

  async function saveEdit() {
    const now = new Date().toISOString();
    await db.items.update(item.client_uuid, {
      label: editLabel.trim(),
      notes: editNotes.trim(),
      updated_at: now,
      sync_status: "pending",
    });
    onCancelEdit();
  }

  async function deleteItem() {
    if (!confirm(`Delete "${item.label || "this item"}"?`)) return;
    const now = new Date().toISOString();
    await db.items.update(item.client_uuid, { deleted: true, updated_at: now, sync_status: "pending" });
    onCancelEdit();
  }

  async function deleteImage(imgUuid: string) {
    const now = new Date().toISOString();
    await db.images.update(imgUuid, { deleted: true, updated_at: now, sync_status: "pending" });
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
        processImage(file, file.type || "image/jpeg").then((processed) => {
          db.images.update(uuid, {
            blob: processed.blob,
            thumbnail_data_url: processed.thumbnailDataUrl,
            width: processed.width,
            height: processed.height,
          });
        }).catch((err) => console.error("Photo processing failed:", err));
      }
      await db.items.update(item.client_uuid, { updated_at: now, sync_status: "pending" });
    } finally {
      setAddingPhotos(false);
    }
  }

  if (isEditing) {
    return (
      <div className="item-card" onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="badge badge-cat">{item.category}</span>
          <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 13 }} onClick={onCancelEdit}>
            <IconX size={16} />
            Cancel
          </button>
        </div>
        <div className="field">
          <label>Label / Location</label>
          <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="e.g. Front door, Camera 12" />
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Notes…" />
        </div>
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
          <button className="btn btn-primary" onClick={saveEdit} style={{ flex: 1 }}>
            <IconCheck size={18} />
            Save
          </button>
        </div>
        <button className="btn btn-danger btn-block" onClick={deleteItem}>
          <IconTrash size={16} />
          Delete item
        </button>
      </div>
    );
  }

  return (
    <div className="item-card" onClick={onToggle}>
      <div className="row between">
        <strong>{item.label || "Untitled"}</strong>
        <div className="row" style={{ gap: 6 }}>
          {item.sync_status === "pending" && <span className="badge badge-pending">pending</span>}
          <button
            className="btn btn-ghost"
            style={{ padding: "4px 10px", fontSize: 13 }}
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            title="Edit item"
          ><IconEdit size={16} /></button>
        </div>
      </div>
      {item.notes && <div className="notes-preview">{item.notes}</div>}
      {visibleImgs.length > 0 && (
        <div className="thumbs">
          {visibleImgs.slice(0, isOpen ? visibleImgs.length : 4).map((img) => (
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
      {isOpen && visibleImgs.length > 4 && (
        <div className="small muted" style={{ marginTop: 4 }}>{visibleImgs.length} photos total</div>
      )}
    </div>
  );
}
