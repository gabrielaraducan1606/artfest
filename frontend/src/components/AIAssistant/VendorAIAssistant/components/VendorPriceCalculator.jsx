// src/components/AIAssistant/Vendor/components/VendorPriceCalculator.jsx

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { sendPriceCalculatorTurn } from "../services/vendorPriceCalculatorApi.js";
import { saveProductCosting } from "../../../../pages/Vendor/CostsProfit/productCostingApi.js";
import PricingBreakdownCard from "../../../../pages/Vendor/CostsProfit/components/PricingBreakdownCard.jsx";
import PendingActionCard from "../../../../pages/Vendor/CostsProfit/components/PendingActionCard.jsx";

import {
  createCostItem,
  updateCostItem,
} from "../../../../pages/Vendor/CostsProfit/costLibraryApi.js";

const WELCOME_MESSAGE =
  "Spune-mi liber din ce e făcut produsul: ce materiale ai folosit, ce cantități și cât te-a costat fiecare. Poți adăuga și ambalajul sau alte costuri. La final îmi spui cât durează să-l faci și cât valorează o oră din munca ta (și, dacă vrei, ce profit îți dorești), iar eu îți calculez prețul.";

const LOADING_MESSAGE =
  "Încarc costing-ul salvat pentru acest produs...";

/* =========================================================
   Helpers
========================================================= */

function createLocalMessage(
  role,
  text
) {
  return {
    id: `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,

    role,
    text,
  };
}

/* =========================================================
   Componentă
========================================================= */

export default function VendorPriceCalculator({
  onBack,
  onClose,
  productId = null,
  onSaved = null,
  initialCostDraft = null,
  headerAction = null,
  onGlobalCommand = null,
  onCreateProductFromCalculator = null,
}) {
  const hasSeed = Boolean(
    productId || initialCostDraft
  );

  const [
    messages,
    setMessages,
  ] = useState([
    {
      id: "welcome",
      role: "assistant",

      text: productId
        ? LOADING_MESSAGE
        : initialCostDraft
          ? "Calculez pe baza materialelor confirmate..."
          : WELCOME_MESSAGE,
    },
  ]);

  const [
    costDraft,
    setCostDraft,
  ] = useState(null);

  const [
    pricing,
    setPricing,
  ] = useState(null);

  const [
    inputValue,
    setInputValue,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(hasSeed);

  const [
    error,
    setError,
  ] = useState("");

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    saveError,
    setSaveError,
  ] = useState("");

  const [
    costingStatus,
    setCostingStatus,
  ] = useState(null);

  /*
   * Sugestie de bibliotecă (CREATE_COST_ITEM / UPDATE_COST_ITEM)
   * pentru materialul/costul NOU sau SCHIMBAT în tura curentă -
   * vine gata calculată de server (costItemSuggestion din
   * răspunsul turei), nu implică un apel separat. Independentă
   * de onGlobalCommand - aici draftul chiar s-a schimbat, doar
   * propunem separat salvarea în bibliotecă.
   */
  const [
    costItemSuggestion,
    setCostItemSuggestion,
  ] = useState(null);

  const [
    costItemSuggestionBusy,
    setCostItemSuggestionBusy,
  ] = useState(false);

  const [
    costItemSuggestionError,
    setCostItemSuggestionError,
  ] = useState("");

  const endRef =
    useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView(
      {
        behavior: "smooth",
        block: "end",
      }
    );
  }, [
    messages,
    pricing,
  ]);

  const history = useMemo(
    () =>
      messages
        .filter(
          (message) =>
            message.id !==
            "welcome"
        )
        .map((message) => ({
          role: message.role,
          text: message.text,
        })),
    [messages]
  );

  /*
   * Nucleul comun al unei ture de conversație - folosit atât
   * de trimiterea unui mesaj normal, cât și de încărcarea
   * inițială (mesaj gol + productId) când se deschide
   * calculatorul pentru un produs anume.
   */
  async function requestTurn({
    message,
    costDraftOverride,
    onSuccess,
    onError,
  }) {
    setLoading(true);
    setError("");

    try {
      const result =
        await sendPriceCalculatorTurn({
          message,
          history,

          costDraft:
            costDraftOverride !== undefined
              ? costDraftOverride
              : costDraft,

          productId,
        });

      setCostDraft(
        result.costDraft ||
          null
      );

      setPricing(
        result.pricing ||
          null
      );

      const suggestion =
        result.costItemSuggestion || null;

      setCostItemSuggestion(
        suggestion?.resultType ===
          "pending_action"
          ? suggestion
          : null
      );

      setCostItemSuggestionError("");

      onSuccess(result);

      /*
       * Dacă sugestia nu e un pendingAction (ex: e ambiguă sau
       * cere costul lipsă), o afișăm doar ca mesaj informativ,
       * DUPĂ mesajul principal al turei, ca să păstrăm ordinea
       * firească a conversației.
       */
      if (
        suggestion &&
        suggestion.resultType !==
          "pending_action" &&
        suggestion.message
      ) {
        setMessages((current) => [
          ...current,
          createLocalMessage(
            "assistant",
            suggestion.message
          ),
        ]);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "A apărut o eroare la calculul prețului.";

      setError(
        errorMessage
      );

      onError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  /*
   * Interceptare comenzi globale de business (ex: "schimbă
   * ceara la 0,06 lei/g", "ce produse am sub 20% profit?",
   * "aplică prețul recomandat la produsul X") - dacă utilizatorul
   * scrie așa ceva CÂT E DEJA în calculator, mesajul nu trebuie
   * tratat ca modificare a draftului curent, ci trimis către
   * orchestratorul principal (vezi handlePriceCalculatorGlobalCommand
   * din VendorAssistant.jsx). Părintele decide - dacă întoarce
   * true, comanda a fost preluată acolo (bibliotecă de costuri /
   * pendingAction / altă vizualizare) și tura din calculator NU
   * mai are loc.
   */
  async function handleSend(
    event
  ) {
    event.preventDefault();

    const text = inputValue.trim();

    if (!text || loading) {
      return;
    }

    setInputValue("");

    if (onGlobalCommand) {
      setLoading(true);

      let handledGlobally = false;

      try {
        handledGlobally = await onGlobalCommand(
          text,
          history
        );
      } catch {
        handledGlobally = false;
      }

      if (handledGlobally) {
        setLoading(false);
        return;
      }

      setLoading(false);
    }

    setMessages(
      (current) => [
        ...current,
        createLocalMessage(
          "user",
          text
        ),
      ]
    );

    await requestTurn({
      message: text,

      onSuccess: (result) => {
        setMessages(
          (current) => [
            ...current,
            createLocalMessage(
              "assistant",

              result.message ||
                "Am notat informațiile."
            ),
          ]
        );
      },

      onError: (errorMessage) => {
        setMessages(
          (current) => [
            ...current,
            createLocalMessage(
              "assistant",
              errorMessage
            ),
          ]
        );
      },
    });
  }

  /*
   * Dacă venim cu un productId și/sau un costDraft inițial
   * (de ex. materiale confirmate dintr-o analiză foto făcută
   * în chat, fără produs asociat), pornim automat (o singură
   * dată) o tură "goală" - backend-ul recunoaște acest caz și
   * NU cheamă LLM-ul, doar calculează determinist ce știe deja.
   */
  useEffect(() => {
    if (!hasSeed) {
      return;
    }

    let cancelled = false;

    requestTurn({
      message: "",
      costDraftOverride: initialCostDraft,

      onSuccess: (result) => {
        if (cancelled) return;

        setMessages([
          {
            id: "welcome",
            role: "assistant",

            text:
              result.message ||
              WELCOME_MESSAGE,
          },
        ]);
      },

      onError: (errorMessage) => {
        if (cancelled) return;

        setMessages([
          {
            id: "welcome",
            role: "assistant",
            text: errorMessage,
          },
        ]);
      },
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  /*
   * Salvarea persistentă (ProductCosting) se face DOAR aici,
   * la o acțiune explicită a vendorului - conversația în sine
   * nu scrie niciodată singură în baza de date.
   */
  async function handleSaveCosting() {
    if (!productId || !costDraft || saving) {
      return;
    }

    setSaving(true);
    setSaveError("");

    try {
      const saved = await saveProductCosting(
        productId,
        costDraft
      );

      setCostingStatus(
        saved?.status || "DRAFT"
      );

      onSaved?.(saved);

      setMessages(
        (current) => [
          ...current,
          createLocalMessage(
            "assistant",

            "Am salvat costing-ul produsului ca ciornă. Îl poți confirma din pagina produsului când ești sigur pe cifre."
          ),
        ]
      );
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : "Nu am putut salva costing-ul."
      );
    } finally {
      setSaving(false);
    }
  }

  /*
   * Punct de extensie, NU implementare completă - calculul
   * temporar (fără productId) nu creează încă produsul în
   * magazin, doar pregătește apelul pentru o etapă viitoare.
   * Dacă părintele oferă onCreateProductFromCalculator, îi
   * trecem costDraft/pricing curente; altfel arătăm explicit
   * că funcționalitatea nu e încă disponibilă, ca să nu pară
   * un buton stricat.
   */
  function handleCreateProductStub() {
    if (onCreateProductFromCalculator) {
      onCreateProductFromCalculator({
        costDraft,
        pricing,
      });

      return;
    }

    setMessages(
      (current) => [
        ...current,
        createLocalMessage(
          "assistant",

          "Crearea automată a produsului direct din calculator va fi disponibilă într-o etapă viitoare. Deocamdată poți adăuga produsul din meniul „Adaugă produs” și să folosești aceste cifre ca reper."
        ),
      ]
    );
  }

  /*
   * Confirmare/renunțare pentru sugestia de bibliotecă -
   * CREATE_COST_ITEM ("Adaugă în bibliotecă" / "Doar pentru
   * calculul acesta") sau UPDATE_COST_ITEM (confirmare simplă).
   * Materialul e deja parte din costDraft indiferent de alegere -
   * doar biblioteca (VendorCostItem) se scrie sau nu.
   */
  async function handleConfirmCostItemSuggestion(
    extra = {}
  ) {
    const action =
      costItemSuggestion?.pendingAction;

    if (!action) return;

    setCostItemSuggestionBusy(true);
    setCostItemSuggestionError("");

    try {
      if (action.kind === "CREATE_COST_ITEM") {
        if (extra.scope === "library") {
          await createCostItem({
            type: action.type,
            name: action.name,
            unit: action.unit || "",
            unitCostCents: action.unitCostCents,
          });
        }
      } else if (
        action.kind === "UPDATE_COST_ITEM"
      ) {
        await updateCostItem(
          action.costItemId,
          {
            unitCostCents:
              action.after.unitCostCents,
          }
        );
      }

      setCostItemSuggestion(null);
    } catch (err) {
      setCostItemSuggestionError(
        err instanceof Error
          ? err.message
          : "Nu am putut aplica modificarea."
      );
    } finally {
      setCostItemSuggestionBusy(false);
    }
  }

  function handleCancelCostItemSuggestion() {
    setCostItemSuggestion(null);
    setCostItemSuggestionError("");
  }

  /* =======================================================
     Stiluri
  ======================================================= */

  const wrapperStyle = {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    height: "100%",
    background: "var(--surface, #ffffff)",
  };

  const headerStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent:
      "space-between",
    gap: 12,
    padding: "14px 16px",
    borderBottom:
      "1px solid var(--color-border, #e5e5e5)",
  };

  const headerButtonStyle = {
    border: 0,
    background:
      "transparent",
    cursor: "pointer",
    fontSize: 14,
    color: "var(--color-muted, #6b7280)",
    padding: 6,
  };

  const contentStyle = {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: 16,
  };

  const bubbleWrapStyle = (
    isUser
  ) => ({
    display: "flex",
    justifyContent: isUser
      ? "flex-end"
      : "flex-start",
    marginBottom: 10,
  });

  const bubbleStyle = (
    isUser
  ) => ({
    maxWidth: "88%",
    borderRadius: 14,
    padding: "9px 12px",
    fontSize: 13.5,
    lineHeight: 1.5,
    whiteSpace:
      "pre-wrap",

    background: isUser
      ? "var(--color-primary, #8b5cf6)"
      : "var(--surface, #ffffff)",

    color: isUser
      ? "#ffffff"
      : "var(--color-text, #2d2d2d)",

    border: isUser
      ? "none"
      : "1px solid var(--color-border, #e5e5e5)",
  });

  const saveBlockStyle = {
    border:
      "1px solid var(--color-border, #e5e5e5)",
    borderRadius: 14,
    padding: 14,
    background:
      "var(--surface, #ffffff)",
    marginTop: 10,
    marginBottom: 12,
  };

  const formStyle = {
    display: "flex",
    gap: 8,
    padding: 12,
    borderTop:
      "1px solid var(--color-border, #e5e5e5)",
  };

  const inputStyle = {
    flex: 1,
    boxSizing:
      "border-box",
    border:
      "1px solid var(--color-border, #e5e5e5)",
    borderRadius: 10,
    padding:
      "10px 11px",
    fontSize: 14,
    outline: "none",
    background:
      "var(--surface, #ffffff)",
  };

  const sendButtonStyle = {
    border: 0,
    borderRadius: 10,
    padding:
      "10px 16px",
    cursor: loading
      ? "not-allowed"
      : "pointer",
    fontWeight: 700,
    fontSize: 14,
    background:
      "var(--color-primary, #8b5cf6)",
    color: "#ffffff",
    opacity: loading
      ? 0.7
      : 1,
  };

  const errorStyle = {
    color: "var(--color-danger, #dc2626)",
    fontSize: 12.5,
    marginTop: 4,
    marginBottom: 8,
  };

  /* =======================================================
     Randare
  ======================================================= */

  return (
    <section
      style={
        wrapperStyle
      }
    >
      <header
        style={
          headerStyle
        }
      >
        <button
          type="button"
          style={
            headerButtonStyle
          }
          onClick={
            onBack
          }
        >
          ← Înapoi
        </button>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
          }}
        >
          <strong>
            Calculator de preț
          </strong>

          {headerAction && (
            <a
              href={headerAction.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 11.5,
                color: "var(--color-primary, #8b5cf6)",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              {headerAction.label}
            </a>
          )}
        </div>

        <button
          type="button"
          style={
            headerButtonStyle
          }
          onClick={
            onClose
          }
          aria-label="Închide"
        >
          ✕
        </button>
      </header>

      <div
        style={
          contentStyle
        }
      >
        {messages.map(
          (message) => (
            <div
              key={
                message.id
              }
              style={bubbleWrapStyle(
                message.role ===
                  "user"
              )}
            >
              <div
                style={bubbleStyle(
                  message.role ===
                    "user"
                )}
              >
                {
                  message.text
                }
              </div>
            </div>
          )
        )}

        {loading && (
          <div
            style={bubbleWrapStyle(
              false
            )}
          >
            <div
              style={bubbleStyle(
                false
              )}
            >
              Calculez...
            </div>
          </div>
        )}

        {pricing && (
          <>
            <PricingBreakdownCard
              pricing={pricing}
            />

            {productId && (
              <div
                style={
                  saveBlockStyle
                }
              >
                <button
                  type="button"
                  onClick={
                    handleSaveCosting
                  }
                  disabled={
                    saving ||
                    !costDraft
                  }
                  style={{
                    width: "100%",
                    border: 0,
                    borderRadius: 10,
                    padding:
                      "10px 14px",
                    cursor: saving
                      ? "not-allowed"
                      : "pointer",
                    fontWeight: 700,
                    fontSize: 13.5,
                    background:
                      "var(--color-success, #16a34a)",
                    color:
                      "#ffffff",
                    opacity: saving
                      ? 0.7
                      : 1,
                  }}
                >
                  {saving
                    ? "Se salvează..."
                    : "Salvează costingul produsului"}
                </button>

                {costingStatus && (
                  <small
                    style={{
                      display:
                        "block",
                      marginTop: 6,
                      color:
                        "var(--color-muted, #6b7280)",
                    }}
                  >
                    Stare salvată:{" "}
                    {costingStatus ===
                    "CONFIRMED"
                      ? "confirmat"
                      : "ciornă"}
                  </small>
                )}

                {saveError && (
                  <small
                    style={{
                      display:
                        "block",
                      marginTop: 6,
                      color:
                        "var(--color-danger, #dc2626)",
                    }}
                  >
                    {saveError}
                  </small>
                )}
              </div>
            )}

            {!productId && (
              <div
                style={
                  saveBlockStyle
                }
              >
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: 13,
                    color: "var(--color-text, #2d2d2d)",
                  }}
                >
                  Vrei să creezi produsul
                  în magazin folosind
                  aceste date?
                </p>

                <button
                  type="button"
                  onClick={
                    handleCreateProductStub
                  }
                  style={{
                    width: "100%",
                    border:
                      "1px solid var(--color-border, #e5e5e5)",
                    borderRadius: 10,
                    padding:
                      "10px 14px",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 13.5,
                    background:
                      "var(--surface, #ffffff)",
                    color: "var(--color-text, #2d2d2d)",
                  }}
                >
                  Creează produsul în
                  magazin
                </button>
              </div>
            )}
          </>
        )}

        {costItemSuggestion?.pendingAction && (
          <PendingActionCard
            action={
              costItemSuggestion.pendingAction
            }
            busy={costItemSuggestionBusy}
            error={costItemSuggestionError}
            onConfirm={
              handleConfirmCostItemSuggestion
            }
            onCancel={
              handleCancelCostItemSuggestion
            }
          />
        )}

        {error && (
          <div
            style={
              errorStyle
            }
          >
            {error}
          </div>
        )}

        <div
          ref={endRef}
        />
      </div>

      <form
        onSubmit={
          handleSend
        }
        style={
          formStyle
        }
      >
        <input
          type="text"
          value={
            inputValue
          }
          onChange={(
            event
          ) =>
            setInputValue(
              event.target
                .value
            )
          }
          placeholder="Descrie costurile produsului..."
          style={
            inputStyle
          }
          disabled={
            loading
          }
        />

        <button
          type="submit"
          style={
            sendButtonStyle
          }
          disabled={
            loading ||
            !inputValue.trim()
          }
        >
          {loading
            ? "..."
            : "Trimite"}
        </button>
      </form>
    </section>
  );
}
