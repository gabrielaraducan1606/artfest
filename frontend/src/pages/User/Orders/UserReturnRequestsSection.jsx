// src/pages/User/Orders/UserReturnRequestsSection.jsx

/*
 * Cererile de retur ale clientului pentru comanda deschisă: status (etichetă
 * calculată server-side din statusurile existente), produse, ultimul
 * răspuns al vânzătorului (motiv / instrucțiuni / informații cerute), link
 * spre conversația comenzii și transportul returului (metodă, adresa de
 * ridicare - modificabilă până la AWB -, AWB, etichetă, urmărire).
 * Date: GET /api/user/orders/:id -> returnRequests.
 * Scriere: PATCH /api/user/returns/:id/method (serverul decide dacă e permis).
 */

import { api } from "../../../lib/api";
import ClientReturnCard from "../../../components/Returns/ClientReturnCard.jsx";
import { clientLabelPath } from "../../../components/Returns/returnLogistics.js";
import { returnStyles as styles } from "../../../components/Returns/returnUtils.js";

export default function UserReturnRequestsSection({ order, className, onChanged }) {
  const list = Array.isArray(order?.returnRequests) ? order.returnRequests : [];

  if (!list.length) return null;

  async function saveMethod(rr, returnMethod, pickupAddress) {
    await api(`/api/user/returns/${encodeURIComponent(rr.id)}/method`, {
      method: "PATCH",
      body: { returnMethod, pickupAddress },
    });
    await onChanged?.();
  }

  return (
    <section className={`${className || ""} ${styles.section}`}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Cereri de retur</h3>
        <span className={styles.count}>{list.length}</span>
      </div>

      {list.map((rr) => (
        <ClientReturnCard
          key={rr.id}
          rr={rr}
          conversationLink={rr.threadId ? `/cont/mesaje?threadId=${encodeURIComponent(rr.threadId)}` : "/cont/mesaje"}
          onSaveMethod={saveMethod}
          labelPath={(r, format) => clientLabelPath({ returnRequestId: r.id, format })}
          defaultAddress={order?.shippingAddress || null}
        />
      ))}
    </section>
  );
}
