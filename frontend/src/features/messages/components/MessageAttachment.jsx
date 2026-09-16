// frontend/src/features/messages/components/MessageAttachment.jsx
//
// ETAPA 3 (refactor comun Mesaje) - consolideaza randarea de attachment-uri
// (grid de imagini + carduri de fisiere), aproape identica intre
// UserMessages.jsx (inline in MessageBubble) si Vendor/Mesaje/Messages.jsx
// (componenta AttachmentList separata).
//
// Foloseste STRICT contractul din ETAPA 2: id/name/mime/size/previewUrl/
// downloadUrl. Nu accepta si nu construieste niciun URL R2 brut - daca un
// attachment n-are previewUrl, arata un placeholder in loc sa incerce alt
// fallback.
//
// `styles` e modulul CSS al paginii care il foloseste (User si Vendor au
// aceleasi nume de clase pentru att* - attGrid/attThumb/attFiles/
// attFileCard/etc - verificat inainte de extragere, deci componenta merge
// neschimbata cu oricare din cele doua CSS module).

import { FileText } from "lucide-react";
import { isImageMime, formatBytes } from "../utils/messageFormatters";

export default function MessageAttachment({ attachments, styles }) {
  const atts = Array.isArray(attachments) ? attachments : [];
  if (!atts.length) return null;

  const imgAtts = atts.filter((a) => isImageMime(a?.mime));
  const fileAtts = atts.filter((a) => !isImageMime(a?.mime));

  return (
    <div className={styles.attWrap}>
      {!!imgAtts.length && (
        <div className={styles.attGrid} data-count={imgAtts.length}>
          {imgAtts.map((a) => {
            const href = a?.previewUrl;
            return (
              <a
                key={a.id}
                className={styles.attThumb}
                href={href || "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (!href) e.preventDefault();
                }}
                title={a.name || "Imagine"}
              >
                {href ? (
                  <img src={href} alt={a.name || "Imagine"} loading="lazy" />
                ) : (
                  <div className={styles.attThumbPlaceholder}>IMG</div>
                )}
              </a>
            );
          })}
        </div>
      )}

      {!!fileAtts.length && (
        <div className={styles.attFiles}>
          {fileAtts.map((a) => {
            const href = a?.previewUrl;
            return (
              <a
                key={a.id}
                className={styles.attFileCard}
                href={href || "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (!href) e.preventDefault();
                }}
                title={a.name || "Fișier"}
              >
                <span className={styles.attFileIcon}>
                  <FileText size={16} />
                </span>

                <span className={styles.attFileMeta}>
                  <span className={styles.attFileName}>{a.name || "Fișier"}</span>
                  <span className={styles.attFileSub}>
                    {a.size ? formatBytes(a.size) : ""}
                    {a.pending ? " · în curs…" : ""}
                  </span>
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
