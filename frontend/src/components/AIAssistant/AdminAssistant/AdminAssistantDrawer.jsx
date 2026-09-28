// src/components/AIAssistant/AdminAssistant/AdminAssistantDrawer.jsx

/*
 * Asistent Admin - drawer deschis din navbar-ul Admin, fără navigare.
 * Reutilizează copilotul COMUN (POST /api/assistant/copilot/ask prin
 * sendCopilotAsk, același ca AiAssistant/VendorAssistant) - rolul ADMIN
 * vine din sesiune, server-side. Nu există un al doilea backend AI.
 *
 * STRICT informativ: răspunde, explică și oferă link-uri (ex. lista
 * filtrată de produse de verificat). Nu aprobă / nu respinge nimic -
 * backend-ul (adminAssistantModeration.js) e read-only.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Bot, Send, X } from "lucide-react";

import { sendCopilotAsk } from "../copilotApi.js";

const SUGGESTIONS = [
  "Câte produse am de verificat?",
  "Arată-mi produsele care au nevoie de review",
  "Ce produse au fost blocate de AI?",
  "Ce produse au fost auto-aprobate?",
  "Ce înseamnă GPSR incomplet?",
];

const FALLBACK_MESSAGE =
  "Nu am un răspuns sigur la asta. Pot să-ți spun câte produse ai de verificat, de ce a ajuns un produs la verificare, ce produse au fost blocate sau aprobate automat și ce înseamnă GPSR incomplet.";

let messageSeq = 0;

function createMessage(role, content, links = []) {
  messageSeq += 1;
  return { id: `admin-assistant-${messageSeq}`, role, content, links };
}

export default function AdminAssistantDrawer({ open, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [messages, setMessages] = useState(() => [
    createMessage(
      "assistant",
      "Salut! Te pot ajuta cu moderarea produselor. Alege o întrebare sau scrie-mi."
    ),
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const listRef = useRef(null);
  const inputRef = useRef(null);

  // produsul deschis prin link direct (?productId=) - doar HINT pentru
  // „de ce a ajuns produsul acesta la verificare?"
  const productIdFromUrl = new URLSearchParams(location.search).get("productId");

  useEffect(() => {
    if (!open) return undefined;

    const onEsc = (e) => {
      if (e.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", onEsc);
    window.setTimeout(() => inputRef.current?.focus(), 0);

    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const ask = useCallback(
    async (text) => {
      const value = String(text || "").trim();
      if (!value || sending) return;

      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, createMessage("user", value)]);
      setInput("");
      setSending(true);

      try {
        const result = await sendCopilotAsk({
          message: value,
          history,
          currentPage: { pathname: location.pathname, pageType: "ADMIN" },
          currentEntity: productIdFromUrl
            ? { type: "PRODUCT", id: productIdFromUrl }
            : null,
        });

        const content =
          result?.handled !== false && result?.message
            ? result.message
            : FALLBACK_MESSAGE;

        setMessages((prev) => [
          ...prev,
          createMessage(
            "assistant",
            content,
            Array.isArray(result?.links) ? result.links : []
          ),
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          createMessage(
            "assistant",
            "Asistentul nu a putut răspunde acum. Încearcă din nou peste câteva secunde."
          ),
        ]);
      } finally {
        setSending(false);
      }
    },
    [messages, sending, location.pathname, productIdFromUrl]
  );

  if (!open) return null;

  const node = (
    <div
      role="presentation"
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.25)",
      }}
    >
      <aside
        role="dialog"
        aria-label="Asistent Admin"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: "100%",
          width: "min(420px, 100vw)",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-bg, #fff)",
          color: "var(--color-text, #111827)",
          borderLeft: "1px solid var(--color-border, #e5e7eb)",
          boxShadow: "-12px 0 40px rgba(0,0,0,0.18)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "14px 16px",
            borderBottom: "1px solid var(--color-border, #e5e7eb)",
          }}
        >
          <strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Bot size={18} /> Asistent Admin
          </strong>

          <button
            type="button"
            onClick={onClose}
            aria-label="Închide asistentul"
            style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit" }}
          >
            <X size={20} />
          </button>
        </header>

        <div
          ref={listRef}
          style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gap: 10, alignContent: "start" }}
        >
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                justifySelf: m.role === "user" ? "end" : "start",
                maxWidth: "90%",
                padding: "9px 12px",
                borderRadius: 12,
                whiteSpace: "pre-wrap",
                lineHeight: 1.45,
                fontSize: 14,
                background:
                  m.role === "user"
                    ? "var(--color-primary, #7c3aed)"
                    : "var(--color-hover, #f3f4f6)",
                color: m.role === "user" ? "#fff" : "inherit",
              }}
            >
              {m.content}

              {m.links?.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {m.links.map((link) => (
                    <button
                      key={`${m.id}-${link.href}`}
                      type="button"
                      onClick={() => {
                        onClose?.();
                        navigate(link.href);
                      }}
                      style={{
                        border: "1px solid var(--color-border, #d1d5db)",
                        background: "var(--color-bg, #fff)",
                        color: "inherit",
                        borderRadius: 999,
                        padding: "4px 10px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}

          {sending && (
            <div style={{ color: "var(--color-text-muted, #6b7280)", fontSize: 13 }}>
              Verific…
            </div>
          )}
        </div>

        <div style={{ padding: "0 16px 8px", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={sending}
              onClick={() => ask(s)}
              style={{
                border: "1px solid var(--color-border, #d1d5db)",
                background: "transparent",
                color: "inherit",
                borderRadius: 999,
                padding: "4px 10px",
                fontSize: 12,
                cursor: sending ? "not-allowed" : "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          style={{
            display: "flex",
            gap: 8,
            padding: 12,
            borderTop: "1px solid var(--color-border, #e5e7eb)",
          }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Întreabă despre moderarea produselor…"
            aria-label="Mesaj pentru Asistentul Admin"
            style={{
              flex: 1,
              padding: "9px 12px",
              borderRadius: 10,
              border: "1px solid var(--color-border, #d1d5db)",
              background: "transparent",
              color: "inherit",
            }}
          />

          <button
            type="submit"
            disabled={sending || !input.trim()}
            aria-label="Trimite"
            style={{
              border: 0,
              borderRadius: 10,
              padding: "0 12px",
              background: "var(--color-primary, #7c3aed)",
              color: "#fff",
              cursor: sending || !input.trim() ? "not-allowed" : "pointer",
              opacity: sending || !input.trim() ? 0.6 : 1,
            }}
          >
            <Send size={16} />
          </button>
        </form>
      </aside>
    </div>
  );

  return createPortal(node, document.body);
}
