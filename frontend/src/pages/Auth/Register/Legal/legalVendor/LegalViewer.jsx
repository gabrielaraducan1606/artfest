import { useEffect, useState } from "react";

export default function LegalViewer({ type, titleFallback }) {
  const [html, setHtml] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        // endpointul servește HTML complet (doctype+body). Îl afișăm doar <main> ca innerHTML.
        // Luăm varianta "html compactă" din /api/legal/html/:type
        const res = await fetch(`/api/legal/html/${encodeURIComponent(type)}`, {
          credentials: "include",
          headers: { Accept: "text/html" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!alive) return;

        // extrage doar <body> ca să nu dublăm head/meta (opțional)
        const match = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        setHtml(match ? match[1] : text);
      } catch  {
        setErr("Nu am putut încărca documentul.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [type]);

  if (loading) return <div style={{ padding: 24 }}>Se încarcă…</div>;
  if (err) return <div style={{ padding: 24, color: "crimson" }}>{err}</div>;

  return (
    <section style={{ maxWidth: 900, margin: "32px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 12 }}>{titleFallback}</h1>
      <article
        className="legal-doc"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <style>{`
        .legal-doc h1, .legal-doc h2, .legal-doc h3 { margin-top: 1.25em; }
        .legal-doc p, .legal-doc li { line-height: 1.6; }
        .legal-doc a { color: #6c4ef7; text-decoration: none; }
        .legal-doc a:hover { text-decoration: underline; }
        .legal-doc .meta { color: #666; font-size: 14px; }
      `}</style>
    </section>
  );
}
