// client/src/lib/api.js
export async function api(path, opts = {}) {
  const {
    method = "GET",
    body,
    headers,
    ...rest
  } = opts;

  const init = {
    method,
    credentials: "include",
    headers: { ...(headers || {}) },
    ...rest,
  };

  // ----- Body & Content-Type handling -----
  if (body !== undefined && body !== null) {
    // 1) FormData → nu setăm Content-Type manual
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      init.body = body;
    }
    // 2) String → îl trimitem ca atare (nu mai stringify)
    else if (typeof body === "string") {
      init.body = body;
      if (!init.headers["Content-Type"]) {
        // dacă seamănă a JSON, setează application/json, altfel text/plain
        try {
          JSON.parse(body);
          init.headers["Content-Type"] = "application/json";
        } catch {
          init.headers["Content-Type"] = "text/plain;charset=UTF-8";
        }
      }
    }
    // 3) Orice alt obiect → JSON
    else {
      init.body = JSON.stringify(body);
      init.headers["Content-Type"] = init.headers["Content-Type"] || "application/json";
    }
  }

  const res = await fetch(path, init);

  const contentType = res.headers.get("content-type") || "";
  let data;

  if (res.status === 204) {
    data = null;
  } else if (contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    // încearcă text; dacă pare JSON, încearcă parse
    const text = await res.text();
    try {
      data = text && text[0] === "{" ? JSON.parse(text) : text;
    } catch {
      data = text;
    }
  }

  if (res.status === 401) return { __unauth: true };

  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) ||
      (typeof data === "string" ? data : "Request failed");
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}
