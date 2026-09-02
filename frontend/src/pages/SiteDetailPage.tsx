import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useState } from "react";

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
    if (!site || !confirm(`Delete site "${site.business_name}"? This cannot be undone (after sync).`)) return;
    const now = new Date().toISOString();
    await db.sites.update(site.client_uuid, { deleted: true, updated_at: now, sync_status: "pending" });
    const siteItems = await db.items.where("site_client_uuid").equals(site.client_uuid).toArray();
    for (const it of siteItems) {
      await db.items.update(it.client_uuid, { deleted: true, updated_at: now, sync_status: "pending" });
    }
    navigate("/");
  }

  return (
    <div>
      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0, fontSize: 20 }}>{site.business_name || "Untitled"}</h2>
          {site.sync_status === "pending" && <span className="badge badge-pending">pending</span>}
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>{site.survey_date || "no date"}</div>
        {site.address_line1 && <div className="small">{site.address_line1}{site.address_line2 ? `, ${site.address_line2}` : ""}</div>}
        {(site.city || site.state || site.zip) && (
          <div className="small">{site.city}{site.city && site.state ? ", " : ""}{site.state} {site.zip}</div>
        )}
        {site.contact_name && <div className="small muted">Contact: {site.contact_name} {site.contact_phone ? `· ${site.contact_phone}` : ""}</div>}
        {site.surveyor_name && <div className="small muted">Surveyor: {site.surveyor_name}</div>}
        {site.general_notes && <div className="small" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{site.general_notes}</div>}

        <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
          <Link to={`/sites/${site.client_uuid}/survey`} className="btn btn-primary">+ Add Items</Link>
          <Link to={`/sites/${id}/edit`} className="btn">Edit</Link>
          <Link to={`/sites/${id}/export`} className="btn">Export</Link>
          <button className="btn btn-danger" onClick={deleteSite}>Delete</button>
        </div>
      </div>

      {visibleItems.length === 0 ? (
        <div className="empty">
          <div className="big">📷</div>
          <div>No items yet.</div>
          <Link to={`/sites/${site.client_uuid}/survey`} className="btn btn-primary" style={{ marginTop: 12 }}>Start Surveying</Link>
        </div>
      ) : (
        cats.map((cat) => (
          <div key={cat}>
            <h3 style={{ fontSize: 15, color: "var(--brand)", margin: "16px 0 6px", borderBottom: "1px solid var(--border)", paddingBottom: 4 }}>
              {cat} <span className="muted tiny">({byCat.get(cat)!.length})</span>
            </h3>
            {byCat.get(cat)!.map((it) => {
              const imgs = imgByItem.get(it.client_uuid) ?? [];
              const isOpen = expanded === it.client_uuid;
              return (
                <div key={it.client_uuid} className="item-card" onClick={() => setExpanded(isOpen ? null : it.client_uuid)}>
                  <div className="row between">
                    <strong>{it.label || "Untitled"}</strong>
                    {it.sync_status === "pending" && <span className="badge badge-pending">pending</span>}
                  </div>
                  {it.notes && <div className="notes-preview">{it.notes}</div>}
                  {imgs.length > 0 && (
                    <div className="thumbs">
                      {imgs.slice(0, isOpen ? imgs.length : 4).map((img) => (
                        <img
                          key={img.client_uuid}
                          src={img.thumbnail_data_url ?? (img.blob ? URL.createObjectURL(img.blob) : "")}
                          alt={it.label}
                        />
                      ))}
                    </div>
                  )}
                  {isOpen && (
                    <div className="small muted" style={{ marginTop: 8 }}>
                      {imgs.length} photo{imgs.length !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
