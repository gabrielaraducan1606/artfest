// src/pages/Guest/GuestReturns/GuestReturnsPage.jsx
//
// /retur-guest/:id - retururile unei comenzi GUEST (fără cont).
//  - ?token=       tokenul original al comenzii (din emailul de confirmare /
//                  pagina /comanda-guest): solicitare retur + urmărire;
//  - ?orderToken=  token semnat din emailul „predat curierului”: același acces
//                  ca ?token= pentru retur (solicitare după livrare + urmărire);
//  - ?returnToken= token semnat din emailurile de status ale returului:
//                  doar urmărire + răspuns către vânzător.
// Același formular (ReturnRequestModal, mode="guest") și aceleași reguli ca
// pentru clienții cu cont. Nu se creează cont.

import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { api } from "../../../lib/api";
import ReturnRequestModal from "../../User/Orders/ReturnRequestModal/ReturnRequestModal.jsx";
import ClientReturnCard from "../../../components/Returns/ClientReturnCard.jsx";
import { returnStyles } from "../../../components/Returns/returnUtils.js";
import styles from "./GuestReturnsPage.module.css";

export default function GuestReturnsPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();

  const token = String(searchParams.get("token") || "").trim();
  const orderToken = String(searchParams.get("orderToken") || "").trim();
  const returnToken = String(searchParams.get("returnToken") || "").trim();
  const access = token
    ? `token=${encodeURIComponent(token)}`
    : orderToken
      ? `orderToken=${encodeURIComponent(orderToken)}`
      : `returnToken=${encodeURIComponent(returnToken)}`;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token && !orderToken && !returnToken) {
      setError("Linkul nu este complet. Folosește linkul din emailul comenzii.");
      setLoading(false);
      return;
    }

    try {
      setError("");
      const res = await api(`/api/guest/orders/${encodeURIComponent(id)}/returns?${access}`);
      setData(res);
    } catch (e) {
      setError(e?.data?.message || e?.message || "Nu am putut încărca retururile acestei comenzi.");
    } finally {
      setLoading(false);
    }
  }, [id, access, token, orderToken, returnToken]);

  useEffect(() => {
    load();
  }, [load]);

  const list = Array.isArray(data?.returnRequests) ? data.returnRequests : [];
  const canCreate = Boolean(data?.canCreate && data?.order?.status === "DELIVERED");
  const orderLabel = data?.order?.orderNumber || id;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Comanda #{orderLabel}</p>
          <h1 className={styles.title}>Retururi</h1>
          <p className={styles.lead}>
            Solicită și urmărește returul fără cont. Nu expedia produsul până când vânzătorul nu acceptă cererea -
            abia atunci primești instrucțiunile și adresa de retur.
          </p>
        </div>

        {canCreate && (
          <button type="button" className={`${returnStyles.btn} ${returnStyles.btnPrimary}`} onClick={() => setModalOpen(true)}>
            Solicită retur
          </button>
        )}
      </header>

      {loading ? (
        <p className={styles.muted}>Se încarcă…</p>
      ) : error ? (
        <div className={`${returnStyles.notice} ${returnStyles.notice_danger}`}>{error}</div>
      ) : (
        <>
          {data?.canCreate && data?.order?.status !== "DELIVERED" && (
            <div className={returnStyles.notice}>Returul poate fi solicitat după livrarea comenzii.</div>
          )}

          {list.length === 0 ? (
            <div className={styles.empty}>Nu ai nicio cerere de retur pentru această comandă.</div>
          ) : (
            <section className={returnStyles.section}>
              {list.map((rr) => (
                <ClientReturnCard
                  key={rr.id}
                  rr={rr}
                  onReply={async (message) => {
                    await api(
                      `/api/guest/orders/${encodeURIComponent(id)}/returns/${encodeURIComponent(rr.id)}/reply?${access}`,
                      { method: "POST", body: { message } }
                    );
                    await load();
                  }}
                />
              ))}
            </section>
          )}

          {(token || orderToken) && (
            <p className={styles.muted}>
              <Link to={`/comanda-guest/${encodeURIComponent(id)}?${access}`}>
                ← Înapoi la comandă
              </Link>
            </p>
          )}
        </>
      )}

      {canCreate && (
        <ReturnRequestModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          orderId={data?.orderId || id}
          mode="guest"
          guestToken={token}
          guestAccessQuery={access}
          onSubmitted={() => load()}
        />
      )}
    </main>
  );
}
