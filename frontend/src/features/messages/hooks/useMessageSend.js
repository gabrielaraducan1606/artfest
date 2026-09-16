// frontend/src/features/messages/hooks/useMessageSend.js
//
// ETAPA 3 (refactor comun Mesaje) - generalizeaza nucleul lui handleSend()
// din UserMessages.jsx si Vendor/Mesaje/Messages.jsx: guard de
// double-submit, mesaj optimist, POST, marcare "failed" pe eroare,
// dispatchMessagesChanged() dupa succes.
//
// Ce NU intra aici (raman callback-uri specifice paginii, pentru ca
// ordinea/comportamentul difera real intre User si Vendor):
//  - User goleste inputul IMEDIAT (optimist), nu il restaureaza la eșec.
//  - Vendor goleste inputul doar la succes si il restaureaza la eșec,
//    plus are eroare de subscriptie/cotă (normalizeChatError, chatBlocked)
//    si un apel extra (reloadUnreadTabs).
// De-aia `onBeforeSend`/`onSuccess`/`onError` sunt callback-uri separate,
// nu logica bagata in hook.
//
// Fix double-submit (test real cu harness jsdom, gap 0ms intre cele doua
// click/Enter): state-ul `sending` din useState e capturat prin closure la
// randare - `setSending(true)` doar PROGRAMEAZA o re-randare, nu muteaza
// sincron valoarea deja capturata de closure-ul in curs de executie. Daca
// al doilea apel ajunge inainte ca React sa apuce sa comita acea
// re-randare, ambele invocari ruleaza pe acelasi closure si vad
// `sending === false` - garda trece de doua ori. `sendingRef` e sursa de
// adevar pentru garda (mutat sincron, vizibil imediat oricarui apel care
// tine acelasi obiect ref); `sending` (state) ramane doar pentru UI
// (disabled/spinner).
//
// ETAPA 5 (idempotency clientMessageId) - un UUID generat o singura data,
// ÎNAINTE de primul await, per tentativa reala de send (un apel al lui
// send()). Trimis in body-ul POST-ului; backend-ul il foloseste ca cheie
// de idempotency (threadId + clientMessageId) pentru retry-uri de rețea /
// requesturi duplicate simultane.
//
// ETAPA 6 (retry manual pe mesaj failed) - retryMessage() de mai jos
// reutilizeaza ACELAȘI clientMessageId al mesajului eșuat (nu genereaza
// unul nou) - asta e exact ce face idempotency-ul din ETAPA 5 util: daca
// primul request a reușit pe backend dar răspunsul s-a pierdut (timeout),
// retry-ul cu același clientMessageId primește înapoi mesajul deja creat,
// fără duplicat.
//
// retryMessage foloseste ACELAȘI sendingRef ca send() - un singur
// send/retry poate fi activ simultan (MVP, cerut explicit) - nu un map de
// refs per mesaj. Nu cheamă onBeforeSend (acela golește/pregătește
// composer-ul pentru textul CURENT din input, irelevant la retrimiterea
// unui mesaj vechi) - cheamă onRetrySuccess/onRetryError daca sunt date,
// altfel cade pe onSuccess/onError (User nu are nevoie de variante
// separate - onSuccess-ul lui nu atinge deloc composer-ul; Vendor are
// nevoie, fiindcă onSuccess/onError ale lui fac setText(...), ceea ce ar
// rescrie greșit un draft nou, neînceput, din composer).
import { useCallback, useRef, useState } from "react";
import { api } from "../../../lib/api";
import { nowIso, dispatchMessagesChanged } from "../utils/messageFormatters";

export function useMessageSend({
  threadId,
  buildEndpoint,
  setMsgs,
  onBeforeSend,
  onSuccess,
  onError,
  onRetrySuccess,
  onRetryError,
}) {
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const send = useCallback(
    async (rawContent) => {
      const content = (rawContent || "").trim();
      if (!content || !threadId || sendingRef.current) {
        return { ok: false, reason: "guard" };
      }
      sendingRef.current = true;

      const clientMessageId = crypto.randomUUID();

      onBeforeSend?.(content);

      const optimistic = {
        id: `local_${Date.now()}`,
        threadId,
        from: "me",
        body: content,
        createdAt: nowIso(),
        pending: true,
        readByPeer: false,
        attachments: [],
        clientMessageId,
      };

      setMsgs((m) => [...m, optimistic]);
      setSending(true);

      try {
        const endpoint = buildEndpoint(threadId);
        await api(`${endpoint}/messages`, {
          method: "POST",
          body: { body: content, clientMessageId },
        });

        await onSuccess?.(content);
        dispatchMessagesChanged(threadId);
        return { ok: true };
      } catch (err) {
        setMsgs((m) =>
          m.map((x) => (x.id === optimistic.id ? { ...x, failed: true, pending: false } : x))
        );
        await onError?.(err, content);
        return { ok: false, reason: "error", error: err };
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [threadId, buildEndpoint, setMsgs, onBeforeSend, onSuccess, onError]
  );

  const retryMessage = useCallback(
    async (failedMessage) => {
      if (!failedMessage?.failed) return { ok: false, reason: "not_failed" };

      const content = (failedMessage.body || "").trim();
      if (!content || !threadId || sendingRef.current) {
        return { ok: false, reason: "guard" };
      }
      sendingRef.current = true;

      // fallback pentru mesaje failed vechi (dinainte de ETAPA 5), fără
      // clientMessageId salvat - generăm unul nou doar pentru ele.
      const clientMessageId = failedMessage.clientMessageId || crypto.randomUUID();

      setMsgs((m) =>
        m.map((x) =>
          x.id === failedMessage.id ? { ...x, pending: true, failed: false, retrying: true } : x
        )
      );
      setSending(true);

      const handleSuccess = onRetrySuccess || onSuccess;
      const handleError = onRetryError || onError;

      try {
        const endpoint = buildEndpoint(threadId);
        await api(`${endpoint}/messages`, {
          method: "POST",
          body: { body: content, clientMessageId },
        });

        await handleSuccess?.(content);
        dispatchMessagesChanged(threadId);
        return { ok: true };
      } catch (err) {
        setMsgs((m) =>
          m.map((x) =>
            x.id === failedMessage.id
              ? { ...x, failed: true, pending: false, retrying: false }
              : x
          )
        );
        await handleError?.(err, content);
        return { ok: false, reason: "error", error: err };
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [threadId, buildEndpoint, setMsgs, onSuccess, onError, onRetrySuccess, onRetryError]
  );

  return { sending, send, retryMessage };
}
