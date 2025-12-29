const API = import.meta.env.VITE_API_URL || "https://artfest.ro";
const TOKEN = import.meta.env.VITE_ADMIN_MONITOR_TOKEN;

function headers() {
  if (!TOKEN) console.warn("Missing VITE_ADMIN_MONITOR_TOKEN");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN || ""}`,
  };
}

export async function fetchIncidents({ ack, status, limit, archived, deleted, cursor, includeNotes }) {
  const qs = new URLSearchParams();
  if (ack !== undefined) qs.set("ack", ack);
  if (status) qs.set("status", status);
  if (limit) qs.set("limit", String(limit));
  if (archived !== undefined) qs.set("archived", archived);
  if (deleted !== undefined) qs.set("deleted", deleted);
  if (cursor) qs.set("cursor", cursor);
  if (includeNotes) qs.set("includeNotes", "1");

  const r = await fetch(`${API}/api/admin/monitor/incidents?${qs.toString()}`, {
    headers: headers(),
    credentials: "include",
  });

  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function ackIncident(id, by) {
  const r = await fetch(`${API}/api/admin/monitor/incidents/${id}/ack`, {
    method: "POST",
    headers: headers(),
    credentials: "include",
    body: JSON.stringify({ by }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function archiveIncident(id, by) {
  const r = await fetch(`${API}/api/admin/monitor/incidents/${id}/archive`, {
    method: "POST",
    headers: headers(),
    credentials: "include",
    body: JSON.stringify({ by }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function unarchiveIncident(id) {
  const r = await fetch(`${API}/api/admin/monitor/incidents/${id}/unarchive`, {
    method: "POST",
    headers: headers(),
    credentials: "include",
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function deleteIncident(id, by) {
  const r = await fetch(`${API}/api/admin/monitor/incidents/${id}/delete`, {
    method: "POST",
    headers: headers(),
    credentials: "include",
    body: JSON.stringify({ by }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function addIncidentNote(id, by, note) {
  const r = await fetch(`${API}/api/admin/monitor/incidents/${id}/notes`, {
    method: "POST",
    headers: headers(),
    credentials: "include",
    body: JSON.stringify({ by, note }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
