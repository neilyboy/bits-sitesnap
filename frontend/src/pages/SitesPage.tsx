import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useState } from "react";

export default function SitesPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const sites = useLiveQuery(() => db.sites.where("deleted").equals(0 as any).reverse().sortBy("survey_date"), []);
  const itemCounts = useLiveQuery(async () => {
    const items = await db.items.where("deleted").equals(0 as any).toArray();
    const m = new Map<string, number>();
    for (const it of items) m.set(it.site_client_uuid, (m.get(it.site_client_uuid) ?? 0) + 1);
    return m;
  }, []);

  const filtered = (sites ?? []).filter((s) =>
    !q || s.business_name.toLowerCase().includes(q.toLowerCase())
      || s.address_line1.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Sites</h2>
        <button className="btn btn-primary" onClick={() => navigate("/sites/new")}>+ New Site</button>
      </div>

      <div className="field">
        <input
          type="search"
          placeholder="Search sites…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="big">📋</div>
          <div>No sites yet.</div>
          <div className="small" style={{ marginTop: 6 }}>
            Tap <strong>+ New Site</strong> to start a survey.
          </div>
        </div>
      ) : (
        filtered.map((s) => (
          <Link
            key={s.client_uuid}
            to={`/sites/${s.client_uuid}`}
            className="card clickable"
            style={{ display: "block", textDecoration: "none", color: "inherit" }}
          >
            <div className="row between">
              <strong>{s.business_name || "Untitled Site"}</strong>
              {s.sync_status === "pending" && <span className="badge badge-pending">pending</span>}
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {s.survey_date || "no date"} · {itemCounts?.get(s.client_uuid) ?? 0} items
            </div>
            {s.address_line1 && (
              <div className="small muted">{s.address_line1}{s.city ? `, ${s.city}` : ""}</div>
            )}
          </Link>
        ))
      )}
    </div>
  );
}
