// src/pages/Admin/AdminDesktop/tabs/AdminHelpRequestsPanel.jsx
//
// „Ajutor configurare”: cine are nevoie de ajutor, pentru ce produs și cu ce problemă.
// Citește doar solicitările existente (adminHelpRequests.js). Finalizarea închide
// solicitarea fără să publice. De aici nu pleacă mesaje către vânzător.

import { useState } from "react";
import { splitGpsrHelpBody } from "../../../../utils/gpsrAddressHelp.js";
import {
  TICKET_STATUS_LABELS,
  adminProductLink,
  formatHelpDate,
  helpProductSource,
  productSellerContact,
  splitHelpNote,
  splitHelpTicketBody,
  supportConversationLink,
  ticketSellerContact,
  ticketSellerName,
} from "./adminHelpRequests.js";
import styles from "../css/AdminHelpRequestsPanel.module.css";

function ContactList({ entries, emptyText }) {
  if (!entries.length) return <p className={styles.muted}>{emptyText}</p>;
  return (
    <ul className={styles.contactList}>
      {entries.map((entry) => (
        <li key={`${entry.kind}:${entry.value}`}>
          <span className={styles.muted}>{entry.label}</span>
          <a href={entry.kind === "email" ? `mailto:${entry.value}` : `tel:${entry.value.replace(/\s+/g, "")}`}>{entry.value}</a>
        </li>
      ))}
    </ul>
  );
}

function HelpMessage({ message, details, emptyText = "Vânzătorul nu a lăsat un mesaj." }) {
  return (
    <div className={styles.messageBox}>
      <span className={styles.messageLabel}>Mesajul vânzătorului</span>
      <p className={styles.message}>{message || emptyText}</p>
      {details.length > 0 && (
        <>
          <span className={styles.messageLabel}>Din formular</span>
          <ul className={styles.detailList}>
            {details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ProductRequest({ product, onEdit, onResolve }) {
  const [showContact, setShowContact] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const request = product.reviewRequest || {};
  const open = request.open === true;
  const image = Array.isArray(product.images) && product.images.length ? product.images[0] : "";
  const { message, details } = splitHelpNote(request.note);
  const isPrivate = product.isActive === false && product.isHidden === true;
  const storeName = product.service?.displayName || "—";
  const sellerName = product.vendor?.displayName || "—";
  const contactId = `help-contact-${product.id}`;

  const finish = async () => {
    setWorking(true);
    setError("");
    try {
      await onResolve(product);
      setConfirming(false);
    } catch (e) {
      setError(e?.message || "Nu am putut marca ajutorul ca finalizat.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <li className={styles.card} data-help-product={product.id}>
      <div className={styles.head}>
        <div className={styles.thumbWrap}>
          {image ? <img src={image} alt="" className={styles.thumb} /> : <span className={styles.thumbEmpty}>Fără poză</span>}
        </div>
        <div className={styles.headText}>
          <h4 className={styles.productTitle}>{product.title || "Produs fără titlu"}</h4>
          <p className={styles.meta}>
            <strong>{storeName}</strong>
            {sellerName !== storeName ? ` · ${sellerName}` : ""}
          </p>
          <p className={styles.meta}>
            Solicitat {formatHelpDate(request.requestedAt)} · Produs {product.id}
            {product.vendor?.id ? ` · ID vânzător ${product.vendor.id}` : ""}
          </p>
        </div>
        <div className={styles.badges}>
          <span className={open ? styles.badgeOpen : styles.badgeDone}>{open ? "Nouă" : "Rezolvată"}</span>
          <span className={styles.badgeTicket}>{helpProductSource(product)}</span>
          {isPrivate && <span className={styles.badgePrivate}>Privat{open ? ", așteaptă configurarea" : ""}</span>}
        </div>
      </div>

      <HelpMessage message={message} details={details} />

      <div className={styles.actions}>
        <button type="button" className={styles.primaryBtn} onClick={() => onEdit(product)}>
          Editează produsul
        </button>
        {product.helpTicket && (
          <a className={styles.btn} href={supportConversationLink(product.helpTicket)} data-help-reply>
            Răspunde în Suport
          </a>
        )}
        <button type="button" className={styles.btn} aria-expanded={showContact} aria-controls={contactId} onClick={() => setShowContact((value) => !value)}>
          Date vânzător
        </button>
        {open && !confirming && (
          <button type="button" className={styles.btn} onClick={() => setConfirming(true)}>
            Marchează ajutorul finalizat
          </button>
        )}
      </div>

      {showContact && (
        <div id={contactId} className={styles.contactBox}>
          <p className={styles.meta}>
            <strong>{sellerName}</strong>
            {product.vendor?.city ? ` · ${product.vendor.city}` : ""}
          </p>
          <ContactList entries={productSellerContact(product)} emptyText="Nu există email sau telefon în profilul vânzătorului." />
          {product.service?.slug && (
            <a href={`/magazin/${encodeURIComponent(product.service.slug)}`} target="_blank" rel="noopener noreferrer">
              Deschide magazinul
            </a>
          )}
        </div>
      )}

      {confirming && (
        <div className={styles.confirm} role="group" aria-label="Confirmă finalizarea">
          <p className={styles.confirmText}>Închizi solicitarea. Produsul rămâne nepublicat și nu se trimite nimic vânzătorului.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} disabled={working} onClick={finish}>
              {working ? "Se salvează…" : "Da, finalizează"}
            </button>
            <button type="button" className={styles.btn} disabled={working} onClick={() => setConfirming(false)}>
              Renunță
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function TicketRequest({ item, label = "Ajutor adăugare produs", parseBody = splitHelpTicketBody }) {
  const [showContact, setShowContact] = useState(false);
  const { ticket, first } = item;
  const { message, storeSlug, details, context = {} } = parseBody(first?.body);
  const storeName = ticket.vendor?.displayName || storeSlug || "—";
  const person = ticketSellerName(ticket);
  const contactId = `help-contact-${ticket.id}`;
  const statusOpen = ticket.status !== "closed";
  const photos = (first?.attachments || []).filter((file) => /^https?:\/\//i.test(String(file?.url)));
  const vendorId = ticket.vendorId || ticket.vendor?.id || "";

  return (
    <li className={styles.card} data-help-ticket={ticket.id}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h4 className={styles.productTitle}>{ticket.subject}</h4>
          <p className={styles.meta}>
            <strong>{storeName}</strong>
            {person ? ` · ${person}` : ""}
            {vendorId ? ` · ID vânzător ${vendorId}` : ""}
          </p>
          <p className={styles.meta}>
            Solicitat {formatHelpDate(first?.createdAt || ticket.createdAt || ticket.updatedAt)}
            {context.productId
              ? ` · Produs ${context.productId}`
              : context.draftId
              ? ` · Ciornă ${context.draftId} (pe dispozitivul vânzătorului)`
              : " · Fără produs salvat"}
          </p>
        </div>
        <div className={styles.badges}>
          {ticket.unread && <span className={styles.badgeOpen} data-help-unread>Necitită</span>}
          <span className={statusOpen ? styles.badgeOpen : styles.badgeDone}>{TICKET_STATUS_LABELS[ticket.status] || ticket.status}</span>
          <span className={styles.badgeTicket}>{label}</span>
        </div>
      </div>

      <HelpMessage message={message} details={details} />

      {photos.length > 0 && (
        <ul className={styles.attachments}>
          {photos.map((file) => (
            <li key={file.url}>
              <a href={file.url} target="_blank" rel="noopener noreferrer">
                {file.name || "Fotografie"}
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.btn} aria-expanded={showContact} aria-controls={contactId} onClick={() => setShowContact((value) => !value)}>
          Date vânzător
        </button>
        {context.productId && (
          <a className={styles.btn} href={adminProductLink(context.productId)}>
            Deschide produsul
          </a>
        )}
        <a className={styles.primaryBtn} href={supportConversationLink(ticket)}>
          Răspunde în Suport
        </a>
      </div>

      {showContact && (
        <div id={contactId} className={styles.contactBox}>
          {person && (
            <p className={styles.meta}>
              <strong>{person}</strong>
            </p>
          )}
          <ContactList entries={ticketSellerContact(ticket)} emptyText="Tichetul nu are un email asociat." />
          {storeSlug && (
            <a href={`/magazin/${encodeURIComponent(storeSlug)}`} target="_blank" rel="noopener noreferrer">
              Deschide magazinul
            </a>
          )}
        </div>
      )}
    </li>
  );
}

const TYPE_FILTERS = [
  { value: "all", label: "Toate tipurile" },
  { value: "products", label: "Produse salvate" },
  { value: "product_help", label: "Ajutor adăugare produs" },
  { value: "gpsr_help", label: "Ajutor GPSR" },
];

const STATUS_FILTERS = [
  { value: "active", label: "Nerezolvate" },
  { value: "open", label: "Nouă" },
  { value: "pending", label: "În lucru" },
  { value: "closed", label: "Rezolvată" },
  { value: "all", label: "Toate stările" },
];

// produsele: solicitare deschisă = nouă, închisă = rezolvată
const productStatus = (product) => (product.reviewRequest?.open ? "open" : "closed");

function statusMatches(status, filter) {
  if (filter === "all") return true;
  if (filter === "active") return status !== "closed";
  return status === filter;
}

export default function AdminHelpRequestsPanel({ data, onEdit, onResolved }) {
  const { loading, error, resolveProduct } = data;
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");

  const showType = (type) => typeFilter === "all" || typeFilter === type;
  const products = showType("products") ? data.products.filter((product) => statusMatches(productStatus(product), statusFilter)) : [];
  const tickets = showType("product_help") ? data.tickets.filter((item) => statusMatches(item.ticket.status, statusFilter)) : [];
  const gpsrTickets = showType("gpsr_help") ? (data.gpsrTickets || []).filter((item) => statusMatches(item.ticket.status, statusFilter)) : [];

  const resolve = async (product) => {
    const updated = await resolveProduct(product);
    onResolved?.(product.id, updated);
  };

  if (loading) {
    return (
      <p className={styles.muted} role="status">
        Se încarcă solicitările…
      </p>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="admin-help-title">
      <header>
        <h3 id="admin-help-title" className={styles.title}>
          Ajutor configurare
        </h3>
        <p className={styles.muted}>
          Cererile de ajutor ale vânzătorilor: GPSR, adăugarea unui produs și verificarea unui produs salvat. La tichete răspunzi
          din Suport; de aici nu pleacă niciun mesaj.
        </p>
      </header>

      <div className={styles.filters} role="group" aria-label="Filtre solicitări">
        <select aria-label="Tip solicitare" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          {TYPE_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select aria-label="Stare solicitare" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {!error && !products.length && !tickets.length && !gpsrTickets.length && <p className={styles.empty}>Nu există solicitări pentru filtrele alese.</p>}

      {products.length > 0 && (
        <div className={styles.group}>
          <h4 className={styles.groupTitle}>
            Produse salvate <span className={styles.count}>{products.length}</span>
          </h4>
          <ul className={styles.list}>
            {products.map((product) => (
              <ProductRequest key={product.id} product={product} onEdit={onEdit} onResolve={resolve} />
            ))}
          </ul>
        </div>
      )}

      {tickets.length > 0 && (
        <div className={styles.group}>
          <h4 className={styles.groupTitle}>
            Ajutor adăugare produs <span className={styles.count}>{tickets.length}</span>
          </h4>
          <p className={styles.muted}>Vânzătorul a trimis mesajul fără să salveze produsul. Răspunzi din conversația de suport existentă.</p>
          <ul className={styles.list}>
            {tickets.map((item) => (
              <TicketRequest key={item.ticket.id} item={item} />
            ))}
          </ul>
        </div>
      )}

      {gpsrTickets.length > 0 && (
        <div className={styles.group}>
          <h4 className={styles.groupTitle}>
            Ajutor GPSR <span className={styles.count}>{gpsrTickets.length}</span>
          </h4>
          <p className={styles.muted}>Întrebări despre datele producătorului și adresa poștală GPSR. Nicio adresă nu a fost salvată prin aceste solicitări.</p>
          <ul className={styles.list}>
            {gpsrTickets.map((item) => (
              <TicketRequest key={item.ticket.id} item={item} label="Ajutor GPSR" parseBody={splitGpsrHelpBody} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
