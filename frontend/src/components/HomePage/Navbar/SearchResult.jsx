import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { searchAll } from "../services/search";

function SkeletonCard() {
  return (
    <div style={{
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius)",
      padding: "10px"
    }}>
      <div style={{background:"var(--color-border)", height:160, borderRadius:"8px"}}/>
      <div style={{height:10}}/>
      <div style={{background:"var(--color-border)", height:16, width:"80%", borderRadius:"6px"}}/>
      <div style={{height:8}}/>
      <div style={{background:"var(--color-border)", height:14, width:"40%", borderRadius:"6px"}}/>
    </div>
  );
}

export default function SearchResults() {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") || "").trim();
  const page = Number(params.get("page") || 1);
  const sort = params.get("sort") || "relevance";

  const [state, setState] = useState({ items: [], total: 0, pages: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const abortRef = useRef(null);

  const canSearch = q.length > 0;

  useEffect(() => {
    if (!canSearch) {
      setState({ items: [], total: 0, pages: 0 });
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setErr(null);

    searchAll({ q, page, limit: 24, sort }, controller.signal)
      .then((data) => {
        setState({
          items: data.items || [],
          total: data.total || 0,
          pages: data.pages || 1,
        });
      })
      .catch((e) => {
        if (e.name !== "AbortError") setErr(e);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [q, page, sort, canSearch]);

  const handleSort = (e) => {
    const next = new URLSearchParams(params);
    next.set("sort", e.target.value);
    next.set("page", "1");
    setParams(next, { replace: true });
  };

  const goToPage = (p) => {
    const next = new URLSearchParams(params);
    next.set("page", String(p));
    setParams(next, { replace: true });
  };

  const title = useMemo(() => (q ? `Rezultate pentru "${q}"` : "Căutare"), [q]);

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "1rem" }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: "1.25rem", marginBottom: 8 }}>
        {title}
      </h1>

      {/* Bară de sortare și total */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 12
      }}>
        <div style={{ color: "var(--color-text)", opacity: .8 }}>
          {loading ? "Se încarcă…" : `${state.total} rezultate`}
        </div>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>Sortează:</span>
          <select value={sort} onChange={handleSort} style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            background: "var(--surface)",
            color: "var(--color-text)"
          }}>
            <option value="relevance">Relevanță</option>
            <option value="price_asc">Preț: crescător</option>
            <option value="price_desc">Preț: descrescător</option>
            <option value="newest">Cele mai noi</option>
          </select>
        </label>
      </div>

      {/* Empty state / error */}
      {!loading && canSearch && state.items.length === 0 && !err && (
        <div style={{
          padding: "2rem",
          border: "1px dashed var(--color-border)",
          borderRadius: "var(--radius)",
          textAlign: "center",
          background: "var(--surface)"
        }}>
          N-am găsit nimic pentru <strong>{q}</strong>. Încearcă un alt termen.
        </div>
      )}
      {err && (
        <div style={{ color: "crimson", marginBottom: 12 }}>
          A apărut o eroare la căutare. Reîncearcă.
        </div>
      )}

      {/* Grid rezultate */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: 12
      }}>
        {loading
          ? Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)
          : state.items.map((it) => (
              <Link
                key={it.id}
                to={it.type === "product" ? `/produs/${it.slug || it.id}` : `/magazin/${it.slug || it.id}`}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius)",
                  padding: 10,
                  color: "inherit",
                  textDecoration: "none",
                  background: "var(--surface)"
                }}
              >
                <div style={{
                  width: "100%",
                  aspectRatio: "1/1",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "var(--color-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}>
                  {it.image ? (
                    <img
                      src={it.image}
                      alt={it.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      loading="lazy"
                    />
                  ) : (
                    <span style={{ opacity: .5 }}>fără imagine</span>
                  )}
                </div>
                <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.3 }}>
                  {it.title}
                </div>
                {typeof it.price === "number" && (
                  <div style={{
                    marginTop: 6,
                    fontWeight: 600,
                    color: "var(--color-primary)"
                  }}>
                    {it.price.toFixed(2)} RON
                  </div>
                )}
              </Link>
            ))
        }
      </div>

      {/* Paginare simplă */}
      {state.pages > 1 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", margin: "16px 0" }}>
          <button
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            style={btn()}
          >
            ← Înapoi
          </button>
          <span style={{ alignSelf: "center", opacity: .8 }}>
            Pag. {page} / {state.pages}
          </span>
          <button
            disabled={page >= state.pages}
            onClick={() => goToPage(page + 1)}
            style={btn()}
          >
            Înainte →
          </button>
        </div>
      )}
    </div>
  );
}

function btn() {
  return {
    padding: "6px 12px",
    borderRadius: 9999,
    border: "1px solid var(--color-border)",
    background: "var(--surface)",
    color: "var(--color-text)",
    cursor: "pointer",
    opacity: 1
  };
}
