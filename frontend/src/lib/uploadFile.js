// client/src/lib/uploadFile.js
export async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch("/api/upload", {
    method: "POST",
    body: fd,
    credentials: "include",
  });

  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j?.message || "Upload eșuat.");
  }

  const data = await res.json();
  if (!data?.url) throw new Error("Răspuns invalid de la server.");
  return data.url;
}
