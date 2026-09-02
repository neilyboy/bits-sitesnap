import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type SiteRow } from "../db";
import { useEffect, useState } from "react";
import { v7 as uuidv7 } from "uuid";

const today = () => new Date().toISOString().slice(0, 10);

export default function SiteFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const existing = useLiveQuery(() => (id ? db.sites.get(id) : undefined), [id]);
  const [form, setForm] = useState<Partial<SiteRow>>({
    business_name: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    zip: "",
    contact_name: "",
    contact_phone: "",
    contact_email: "",
    surveyor_name: "",
    survey_date: today(),
    general_notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) setForm(existing);
  }, [existing]);

  function set<K extends keyof SiteRow>(k: K, v: SiteRow[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (existing) {
        await db.sites.update(existing.client_uuid, {
          ...form,
          updated_at: now,
          sync_status: "pending",
        } as Partial<SiteRow>);
        navigate(`/sites/${existing.client_uuid}`);
      } else {
        const row: SiteRow = {
          client_uuid: uuidv7(),
          business_name: form.business_name ?? "",
          address_line1: form.address_line1 ?? "",
          address_line2: form.address_line2 ?? "",
          city: form.city ?? "",
          state: form.state ?? "",
          zip: form.zip ?? "",
          contact_name: form.contact_name ?? "",
          contact_phone: form.contact_phone ?? "",
          contact_email: form.contact_email ?? "",
          surveyor_name: form.surveyor_name ?? "",
          survey_date: form.survey_date ?? today(),
          general_notes: form.general_notes ?? "",
          created_at: now,
          updated_at: now,
          sync_status: "pending",
          deleted: false,
        };
        await db.sites.add(row);
        navigate(`/sites/${row.client_uuid}/survey`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      <h2 style={{ fontSize: 20, marginTop: 0 }}>{existing ? "Edit Site" : "New Site"}</h2>

      <div className="field">
        <label>Business Name *</label>
        <input value={form.business_name ?? ""} onChange={(e) => set("business_name", e.target.value)} required autoFocus />
      </div>
      <div className="field">
        <label>Survey Date</label>
        <input type="date" value={form.survey_date ?? ""} onChange={(e) => set("survey_date", e.target.value)} />
      </div>
      <div className="field">
        <label>Address</label>
        <input value={form.address_line1 ?? ""} onChange={(e) => set("address_line1", e.target.value)} placeholder="Street" />
      </div>
      <div className="field">
        <label>Address Line 2</label>
        <input value={form.address_line2 ?? ""} onChange={(e) => set("address_line2", e.target.value)} placeholder="Suite, building, etc." />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 2 }}>
          <label>City</label>
          <input value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>State</label>
          <input value={form.state ?? ""} onChange={(e) => set("state", e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>ZIP</label>
          <input value={form.zip ?? ""} onChange={(e) => set("zip", e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Contact Name</label>
        <input value={form.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value)} />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Contact Phone</label>
          <input type="tel" value={form.contact_phone ?? ""} onChange={(e) => set("contact_phone", e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Contact Email</label>
          <input type="email" value={form.contact_email ?? ""} onChange={(e) => set("contact_email", e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Surveyor</label>
        <input value={form.surveyor_name ?? ""} onChange={(e) => set("surveyor_name", e.target.value)} />
      </div>
      <div className="field">
        <label>General Notes</label>
        <textarea value={form.general_notes ?? ""} onChange={(e) => set("general_notes", e.target.value)} />
      </div>

      <div className="row" style={{ gap: 10, marginTop: 8 }}>
        <button type="button" className="btn btn-block" onClick={() => navigate(-1)}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
          {saving ? "Saving…" : existing ? "Save" : "Start Surveying"}
        </button>
      </div>
    </form>
  );
}
