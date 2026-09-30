// src/pages/User/Orders/UserReturnRequestsSection.jsx

/*
 * Cererile de retur ale clientului pentru comanda deschisă: status (etichetă
 * calculată server-side din statusurile existente), produse, ultimul
 * răspuns al vânzătorului (motiv / instrucțiuni / informații cerute) și
 * link spre conversația comenzii, unde clientul poate răspunde.
 * Date: GET /api/user/orders/:id -> returnRequests (doar citire).
 */

import ClientReturnCard from "../../../components/Returns/ClientReturnCard.jsx";
import { returnStyles as styles } from "../../../components/Returns/returnUtils.js";

export default function UserReturnRequestsSection({ order, className }) {
  const list = Array.isArray(order?.returnRequests) ? order.returnRequests : [];

  if (!list.length) return null;

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
        />
      ))}
    </section>
  );
}
