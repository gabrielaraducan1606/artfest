// Controller comun pentru <PolicyGate /> în toate desktop-urile (client,
// vendor, influencer): decide ce scope are documente de acceptat, deschide
// gate-ul, îl redeschide pe scope-ul următor după acceptare (ex. clientul
// vendor: întâi USERS - TOS/Privacy/Returns, apoi VENDORS - acorduri vendor)
// și reacționează la 428/412 (`policy:required`, emis de lib/api.js).

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../lib/api.js";
import {
  POLICY_REQUIRED_EVENT,
  pickPendingScope,
  scopeOrderForRole,
} from "../../../../lib/policyRequired.js";

/**
 * @param {object} options
 * @param {{role?: string}|null} options.me         contul curent (null = încă necunoscut)
 * @param {string|null} [options.requestedScope]   scope cerut explicit de link (?scope=)
 * @param {boolean} [options.forceOpen]            linkul cere deschiderea (?policyGate=1)
 * @param {string} [options.defaultScope]
 */
export default function usePolicyGateController({
  me,
  requestedScope = null,
  forceOpen = false,
  defaultScope = "USERS",
}) {
  const [open, setOpen] = useState(Boolean(forceOpen));
  const [scope, setScope] = useState(defaultScope);
  const [blocked, setBlocked] = useState(false);

  const role = me?.role || null;
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    return () => {
      aliveRef.current = false;
    };
  }, []);

  /*
   * Verifică scope-urile rolului în ordine și deschide primul cu documente
   * obligatorii în așteptare. `hint` = scope-uri sugerate de un 428/412.
   */
  const check = useCallback(
    async (hint = []) => {
      const order = scopeOrderForRole(role);

      if (!order.length) return false;

      const gates = {};

      for (const candidate of order) {
        gates[candidate] = await api(
          `/api/policy-gate?scope=${encodeURIComponent(candidate)}`
        ).catch(() => null);
      }

      if (!aliveRef.current) return false;

      const pending = pickPendingScope(order, gates, hint);

      if (pending) {
        setScope(pending);
        setOpen(true);
        return true;
      }

      return false;
    },
    [role]
  );

  // verificarea inițială (și cererea explicită din linkul notificării)
  useEffect(() => {
    if (!role) return undefined;

    let cancelled = false;

    (async () => {
      const opened = await check(requestedScope ? [requestedScope] : []);

      if (cancelled || opened) return;

      // linkul cere explicit gate-ul: îl deschidem pe scope-ul cerut
      if (forceOpen && scopeOrderForRole(role).length) {
        const wanted = scopeOrderForRole(role).includes(requestedScope)
          ? requestedScope
          : scopeOrderForRole(role).slice(-1)[0];

        setScope(wanted);
        setOpen(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [role, requestedScope, forceOpen, check]);

  // 428/412 din orice cerere: reverificăm imediat, fără reload
  useEffect(() => {
    if (!role || typeof window === "undefined") return undefined;

    const onRequired = (event) => {
      const detail = event?.detail;

      if (!detail || detail.kind !== "policy") return;

      check(detail.scopes || []);
    };

    window.addEventListener(POLICY_REQUIRED_EVENT, onRequired);

    return () => window.removeEventListener(POLICY_REQUIRED_EVENT, onRequired);
  }, [role, check]);

  /*
   * La închidere (după acceptarea documentelor unui scope) verificăm dacă
   * mai există un scope cu documente de acceptat și îl deschidem imediat.
   */
  const onClose = useCallback(() => {
    setOpen(false);
    setBlocked(false);

    check();
  }, [check]);

  return { open, scope, blocked, setBlocked, onClose, recheck: check };
}
