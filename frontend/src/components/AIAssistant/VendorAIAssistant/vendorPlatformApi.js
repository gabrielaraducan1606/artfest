export async function askVendorPlatform({
  message,
  history = [],
  pageContext = {},
}) {
  const response = await fetch(
    "/api/assistant/vendor-platform/ask",
    {
      method: "POST",
      credentials: "include",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        message,
        history,
        pageContext,
      }),
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      data?.message ||
        data?.error ||
        "Asistentul nu a putut răspunde."
    );

    error.data = data;

    throw error;
  }

  return data;
}