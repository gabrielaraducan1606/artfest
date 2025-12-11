export async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!res.ok) {
    let msg = "Upload eșuat. Încearcă din nou.";
    try {
      const err = await res.json();
      if (err?.message) msg = err.message;
    } catch {}
    throw new Error(msg);
  }

  const data = await res.json(); // { ok, url, key }
  if (!data?.ok || !data?.url) {
    throw new Error("Upload eșuat. Răspuns invalid.");
  }
  return data.url;
}
