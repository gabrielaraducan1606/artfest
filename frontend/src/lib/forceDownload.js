// src/lib/forceDownload.js
export async function forceDownload(url, filename = "atasament") {
  if (!url) return;

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
  });

  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const blob = await res.blob();
  const blobUrl = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename || "atasament";
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.URL.revokeObjectURL(blobUrl);
}
