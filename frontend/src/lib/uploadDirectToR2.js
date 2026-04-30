const API_URL = import.meta.env.VITE_API_URL;

export async function uploadDirectToR2(file, folder = "uploads") {
  const res = await fetch(`${API_URL}/api/upload/presign`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileName: file.name,
      fileType: file.type,
      folder,
    }),
  });

  const data = await res.json();

  if (!res.ok) throw new Error("Presign failed");

  await fetch(data.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
    },
    body: file,
  });

  return data.url;
}