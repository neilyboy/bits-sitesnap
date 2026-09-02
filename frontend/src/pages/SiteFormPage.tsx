import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, type SiteRow } from "../db";
import { useEffect, useState, useRef } from "react";
import { v7 as uuidv7 } from "uuid";
import { IconChevronLeft, IconCheck, IconImage, IconX } from "../components/Icons";
import { processImage } from "../lib/image";

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
  const [logoPreview, setLogoPreview] = useState<string>("");
  const [logoBlob, setLogoBlob] = useState<Blob | undefined>(undefined);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (existing) {
      setForm(existing);
      // Show logo preview from existing blob if available
      if (existing.logo_blob) {
        const url = URL.createObjectURL(existing.logo_blob);
        setLogoPreview(url);
        setLogoBlob(existing.logo_blob);
      } else if (existing.logo_url) {
        // Fetch logo from server
        (async () => {
          try {
            const token = await getSetting("auth_token", "");
            let base = await getSetting("server_url", "");
            base = base ? base.replace(/\/$/, "") : "";
            let u = existing.logo_url!;
            if (u.startsWith("http") && (u.includes("://localhost") || u.includes("://127.0.0.1"))) {
              try { u = new URL(u).pathname + new URL(u).search; } catch {}
            }
            const fullUrl = u.startsWith("http") ? u : (base + u);
            const resp = await fetch(fullUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
            if (resp.ok) {
              const blob = await resp.blob();
              setLogoBlob(blob);
              setLogoPreview(URL.createObjectURL(blob));
            }
          } catch {}
        })();
      }
    }
  }, [existing]);

  function set<K extends keyof SiteRow>(k: K, v: SiteRow[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onLogoChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (logoInputRef.current) logoInputRef.current.value = "";
    // Process/scale the logo to a reasonable size
    try {
      const processed = await processImage(file, file.type || "image/jpeg");
      setLogoBlob(processed.blob);
      const url = URL.createObjectURL(processed.blob);
      setLogoPreview(url);
    } catch {
      // Fallback: use raw file
      setLogoBlob(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  }

  function removeLogo() {
    setLogoBlob(undefined);
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoPreview("");
    // If editing, also clear the existing logo from the DB
    if (existing) {
      setForm((f) => ({ ...f, logo_blob: undefined, logo_url: undefined, logo_synced: false }));
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (existing) {
        await db.sites.update(existing.client_uuid, {
          ...form,
          logo_blob: logoBlob,
          logo_synced: !logoBlob ? existing.logo_synced : false, // new blob needs upload
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
          logo_blob: logoBlob,
          logo_synced: !logoBlob,
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
      <div className="row between" style={{ marginBottom: 16 }}>
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
          <IconChevronLeft size={20} />
          Back
        </button>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{existing ? "Edit Site" : "New Site"}</h2>
        <span />
      </div>

      {/* Logo upload */}
      <div className="field">
        <label>Company Logo / Image</label>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {logoPreview ? (
            <div style={{ position: "relative" }}>
              <img
                src={logoPreview}
                alt="Logo"
                style={{
                  width: 80, height: 80, objectFit: "cover",
                  borderRadius: 10, border: "1px solid var(--border)",
                }}
              />
              <button
                type="button"
                onClick={removeLogo}
                style={{
                  position: "absolute", top: -6, right: -6,
                  width: 24, height: 24, borderRadius: "50%",
                  background: "var(--danger)", color: "#fff",
                  border: "2px solid var(--bg-elevated)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 0,
                }}
              >
                <IconX size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              style={{
                width: 80, height: 80, borderRadius: 10,
                border: "2px dashed var(--border-light)",
                background: "var(--bg-elevated)", color: "var(--text-muted)",
                cursor: "pointer", display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 4,
              }}
            >
              <IconImage size={24} />
              <span style={{ fontSize: 10 }}>Upload</span>
            </button>
          )}
          <div className="small" style={{ color: "var(--text-muted)", flex: 1 }}>
            {logoPreview ? "Logo will appear on the site list and in reports." : "Upload a company logo or photo. It will be displayed on the site list and included in PDF/HTML reports."}
          </div>
        </div>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          className="hidden-file"
          onChange={onLogoChosen}
        />
      </div>

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
          {saving ? (<><span className="spinner" /> Saving…</>) : (<><IconCheck size={18} /> {existing ? "Save" : "Start Surveying"}</>)}
        </button>
      </div>
    </form>
  );
}
