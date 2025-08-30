import React, { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs/tabs";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../../components/ui/card/card";
import { Button } from "../../components/ui/Button/Button";
import { Input } from "../../components/ui/input/input";
import { Textarea } from "../../components/ui/textarea/textarea";
import { Separator } from "../../components/ui/separator/separator";
import { Switch } from "../../components/ui/switch/switch";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group/radio-group";
import {
  AlertTriangle, CreditCard, Wallet, ShieldCheck, Truck,
  ShoppingCart, ChevronRight, Store
} from "lucide-react";

import styles from "./Cart.module.css";
import Navbar from "../../components/HomePage/Navbar/Navbar";
import Footer from "../../components/HomePage/Footer/Footer";

import useCartState from "./hooks/useCartState";
import useCartTotals from "./hooks/useCartTotals"; // pentru merchandise & discount
import useShippingQuote from "./hooks/useShippingQuote"; // ★ per-seller shipping
import { currency } from "./utils/currency";

import Field from "./components/Field";
import CartRow from "./components/CartRow";
import CouponCard from "./components/CouponCard";
import SummaryCard from "./components/SummaryCard";
import SavedForLater from "./components/SavedForLater";
import { SkeletonHeader, SkeletonRow } from "./components/Skeletons";

export default function Cart() {
  const {
    items, saveForLater, appliedCoupon, loading, error, setError, busyIds,
    debouncedQty, removeItem, clearCart, moveToSFL, addBackFromSFL, applyCoupon, groupedBySeller,
  } = useCartState();

  // flow
  const [tabsUnlocked, setTabsUnlocked] = useState(false);
  const [step, setStep] = useState("cart"); // cart | shipping | payment | review
  const [canReview, setCanReview] = useState(false);

  // form state
  const [coupon, setCoupon] = useState("");
  const [giftNote, setGiftNote] = useState("");
  const [shippingInfo, setShippingInfo] = useState({
    name: "", email: "", phone: "",
    country: "România", county: "", city: "", street: "", zip: ""
  });
  const [shippingErrors, setShippingErrors] = useState({});
  const [paymentMethod, setPaymentMethod] = useState("card"); // card | cod
  const [isPickup, setIsPickup] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // merchandise & discount (păstrăm hook-ul vostru existent)
  const { merchandiseTotal, discount } =
    useCartTotals(items, appliedCoupon, isPickup);

  // === Shipping per-seller (server) ===
  const { shippingTotal, breakdown: shippingBySeller } = useShippingQuote({
    items,
    address: shippingInfo,
    isPickup
  });

  // TVA inclus (informativ)
  const VAT_RATE = 0.19;
  const taxableMerch = Math.max(0, merchandiseTotal - discount);
  const vatIncludedMerch = taxableMerch * VAT_RATE / (1 + VAT_RATE);
  const vatIncludedShip = shippingTotal ? shippingTotal * VAT_RATE / (1 + VAT_RATE) : 0;
  const vatIncluded = vatIncludedMerch + (isPickup ? 0 : vatIncludedShip);
  const grandTotal = Math.max(0, taxableMerch + (isPickup ? 0 : shippingTotal));

  const isEmpty = items.length === 0;

  // ---- validators & navigation
  const validateShipping = () => {
    const e = {};
    if (!isPickup) {
      if (!shippingInfo.name.trim()) e.name = "Nume obligatoriu";
      if (!shippingInfo.phone.trim()) e.phone = "Telefon obligatoriu";
      if (!shippingInfo.city.trim()) e.city = "Oraș obligatoriu";
      if (!shippingInfo.street.trim()) e.street = "Adresă obligatorie";
      if (!shippingInfo.zip.trim()) e.zip = "Cod poștal obligatoriu";
    }
    setShippingErrors(e);
    return Object.keys(e).length === 0;
  };

  const goFromCartToShipping = () => {
    if (isEmpty) return;
    setTabsUnlocked(true);
    setStep("shipping");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goNextFromShipping = () => {
    if (!validateShipping()) return;
    setStep("payment");
    setCanReview(false);
    setAcceptedTerms(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goNextFromPayment = () => {
    setCanReview(true);
    setStep("review");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const placeOrder = async () => {
    if (!acceptedTerms) {
      setError("Te rugăm să accepți termenii și condițiile înainte de a plasa comanda.");
      return;
    }
    try {
      setPlacing(true);
      const payload = {
        items: items.map(it => ({ productId: it.productId, qty: it.qty })), // ✅ productId real
        coupon: appliedCoupon?.code || null,
        note: giftNote || "",
        shipping: {
          method: isPickup ? "pickup" : "courier",
          cost: isPickup ? 0 : shippingTotal,
          address: isPickup ? null : shippingInfo
        },
        payment: { method: paymentMethod },
        totals: {
          merchandise: merchandiseTotal,
          discount,
          vat: vatIncluded,
          shipping: isPickup ? 0 : shippingTotal,
          total: grandTotal
        }
      };
      const api = (await import("../../components/services/api")).default;
      const res = await api.post("/orders", payload).then(r => r.data ?? r);
      if (typeof window !== "undefined") {
        if (res?.orderId) window.location.href = `/order/${res.orderId}`;
        else window.location.href = `/checkout/success`;
      }
    } catch (e) {
      console.error(e);
      setError("Nu am putut plasa comanda. Încearcă din nou.");
    } finally {
      setPlacing(false);
    }
  };

  // ===== LOADING
  if (loading) {
    return (
      <div className={styles.container}>
        <SkeletonHeader />
        <div className={styles.layout}>
          <Card className={`${styles.card} ${styles.padded} ${styles.leftColCard}`}>
            {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}
          </Card>
          <Card className={`${styles.card} ${styles.padded}`} />
        </div>
      </div>
    );
  }

  // ===== VIEW 1: CART (fără Tabs)
  if (!tabsUnlocked) {
    return (
      <div className={styles.container}>
        <Navbar />

        {error && (
          <div className={styles.alert}>
            <AlertTriangle className={styles.icon5} />
            <span className={styles.textSm}>{error}</span>
          </div>
        )}

        <div className={styles.layout}>
          <div className={styles.leftCol}>
            <Card className={`${styles.card} ${styles.listCard}`}>
              <CardHeader className={styles.rowBetween}>
                <CardTitle className={`${styles.titleRow} ${styles.titleLg}`}>
                  <ShoppingCart className={styles.icon5} /> <span>Coșul tău</span>
                </CardTitle>
                {items.length > 0 && (
                  <Button variant="ghost" onClick={clearCart} className={`${styles.btnGhost} ${styles.textSm}`}>
                    Golește coșul
                  </Button>
                )}
              </CardHeader>

              <CardContent className={styles.stackLg}>
                {items.length === 0 ? (
                  <EmptyCart styles={styles} />
                ) : (
                  groupedBySeller.map(group => (
                    <div key={group.sellerId} className={styles.sellerGroup}>
                      <div className={`${styles.row} ${styles.mbSm}`}>
                        <Store className={styles.icon4} />
                        <span className={styles.storeName}>{group.sellerName}</span>
                      </div>
                      <Separator />
                      <div className={styles.divideY}>
                        {group.list.map(it => (
                          <CartRow
                            key={it._id}
                            item={it}
                            busy={busyIds.has(it._id)}
                            onQty={(q) => debouncedQty(it._id, q)}
                            onRemove={() => removeItem(it._id)}
                            onSaveForLater={() => moveToSFL(it._id)}
                            styles={styles}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>

              {items.length > 0 && (
                <CardFooter className={styles.stackMd}>
                  {/* Cupon în coș */}
                  <Card className={styles.card}>
                    <CardHeader>
                      <CardTitle className={styles.titleBase}>Cupon de reducere</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CouponCard
                        coupon={coupon}
                        setCoupon={setCoupon}
                        applyCoupon={() => applyCoupon(coupon)}
                        applied={appliedCoupon}
                        styles={styles}
                      />
                    </CardContent>
                  </Card>

                  <div className={styles.rowBetween}>
                    <div className={`${styles.row} ${styles.mutedSmall}`}>
                      <ShieldCheck className={styles.icon4} />
                      <span>Protecție cumpărături: retur ușor 14 zile.</span>
                    </div>
                    <div className={`${styles.row} ${styles.mutedSmall}`}>
                      <Truck className={styles.icon4} />
                      <span>{shippingTotal === 0 ? "Livrare gratuită" : `Livrare estimată: ${currency(shippingTotal)}`}</span>
                    </div>
                  </div>

                  <div className={styles.actionsRight}>
                    <Button className={styles.btnPrimary} onClick={goFromCartToShipping}>
                      Finalizează comanda <ChevronRight className={`${styles.icon4} ${styles.ml4}`} />
                    </Button>
                  </div>
                </CardFooter>
              )}
            </Card>

            {items.length > 0 && (
              <SavedForLater items={saveForLater} onAdd={addBackFromSFL} styles={styles} />
            )}
          </div>

          {/* fără sidebar pe ecranul Coș */}
        </div>

        <Footer />
      </div>
    );
  }

  // ===== VIEW 2: TABS (Shipping / Payment / Review)
  return (
    <div className={styles.container}>
      <Navbar />

      {error && (
        <div className={styles.alert}>
          <AlertTriangle className={styles.icon5} />
          <span className={styles.textSm}>{error}</span>
        </div>
      )}

      <Tabs
        value={step}
        onValueChange={(v) => {
          if (v === "cart") return;
          if (v === "review" && !canReview) return;
          setStep(v);
          if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        className={styles.tabs}
      >
        <TabsList className={styles.tabsList3}>
          <TabsTrigger value="shipping">Detalii livrare</TabsTrigger>
          <TabsTrigger
            value="payment"
            disabled={isEmpty}
            className={isEmpty ? styles.triggerDisabled : undefined}
          >
            Plată
          </TabsTrigger>
          <TabsTrigger
            value="review"
            disabled={isEmpty || !canReview}
            className={isEmpty || !canReview ? styles.triggerDisabled : undefined}
          >
            Rezumat
          </TabsTrigger>
        </TabsList>

        <div className={styles.layout}>
          {/* LEFT */}
          <div className={styles.leftCol}>
            {/* SHIPPING */}
            <TabsContent value="shipping">
              <Card className={styles.card}>
                <CardHeader>
                  <CardTitle className={styles.titleLg}>Detalii livrare &amp; contact</CardTitle>
                </CardHeader>

                <CardContent className={styles.formGrid}>
                  <div>
                    <Field label="Nume complet" error={shippingErrors.name}>
                      <Input value={shippingInfo.name} onChange={e => setShippingInfo(s => ({ ...s, name: e.target.value }))} />
                    </Field>
                  </div>
                  <div>
                    <Field label="Telefon" error={shippingErrors.phone}>
                      <Input value={shippingInfo.phone} onChange={e => setShippingInfo(s => ({ ...s, phone: e.target.value }))} />
                    </Field>
                  </div>
                  <div>
                    <Field label="Email (opțional)">
                      <Input type="email" value={shippingInfo.email} onChange={e => setShippingInfo(s => ({ ...s, email: e.target.value }))} />
                    </Field>
                  </div>

                  <div className={`${styles.rowBetween} ${styles.spanTwo} ${styles.textSm}`}>
                    <div className={styles.row}>
                      <Truck className={styles.icon4} />
                      <span>Ridicare personală</span>
                    </div>
                    <Switch checked={isPickup} onCheckedChange={setIsPickup} />
                  </div>

                  {!isPickup && (
                    <>
                      <div>
                        <Field label="Țară">
                          <Input value={shippingInfo.country} onChange={e => setShippingInfo(s => ({ ...s, country: e.target.value }))} />
                        </Field>
                      </div>
                      <div>
                        <Field label="Județ">
                          <Input value={shippingInfo.county} onChange={e => setShippingInfo(s => ({ ...s, county: e.target.value }))} />
                        </Field>
                      </div>
                      <div>
                        <Field label="Oraș" error={shippingErrors.city}>
                          <Input value={shippingInfo.city} onChange={e => setShippingInfo(s => ({ ...s, city: e.target.value }))} />
                        </Field>
                      </div>
                      <div>
                        <Field label="Stradă, număr" error={shippingErrors.street}>
                          <Input value={shippingInfo.street} onChange={e => setShippingInfo(s => ({ ...s, street: e.target.value }))} />
                        </Field>
                      </div>
                      <div>
                        <Field label="Cod poștal" error={shippingErrors.zip}>
                          <Input value={shippingInfo.zip} onChange={e => setShippingInfo(s => ({ ...s, zip: e.target.value }))} />
                        </Field>
                      </div>
                    </>
                  )}

                  <div className={styles.spanTwo}>
                    <Field label="Mesaj pentru artizan (opțional)">
                      <Textarea
                        rows={3}
                        placeholder="Ex: ambalare cadou, detalii personalizare..."
                        value={giftNote}
                        onChange={e => setGiftNote(e.target.value)}
                      />
                    </Field>
                  </div>
                </CardContent>

                <CardFooter className={styles.rowBetween}>
                  <Button variant="ghost" onClick={() => { setTabsUnlocked(false); setStep("cart"); }}>
                    Înapoi la coș
                  </Button>
                  <Button className={styles.btnPrimary} onClick={goNextFromShipping}>
                    Continuă către plată <ChevronRight className={`${styles.icon4} ${styles.ml4}`} />
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>

            {/* PAYMENT */}
            <TabsContent value="payment">
              <Card className={styles.card}>
                <CardHeader>
                  <CardTitle className={styles.titleLg}>Metodă de plată</CardTitle>
                </CardHeader>
                <CardContent className={styles.stackLg}>
                  <div>
                    <div className={`${styles.textSm} ${styles.mbXs} ${styles.semi}`}>Alege metoda de plată</div>
                    <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod} className={styles.radioList}>
                      <label className={styles.radioOption}>
                        <RadioGroupItem value="card" id="pm-card" />
                        <CreditCard className={styles.icon4} />
                        <span>Card online</span>
                      </label>
                      <label className={styles.radioOption}>
                        <RadioGroupItem value="cod" id="pm-cod" />
                        <Wallet className={styles.icon4} />
                        <span>Ramburs (cash la livrare)</span>
                      </label>
                    </RadioGroup>
                  </div>

                  <div className={styles.mutedXs}>
                    Reducerile (cupone) au fost aplicate în coș. Totalul final apare în Rezumat.
                  </div>
                </CardContent>
                <CardFooter className={styles.rowBetween}>
                  <Button variant="ghost" onClick={() => setStep("shipping")}>Înapoi</Button>
                  <Button className={styles.btnPrimary} onClick={goNextFromPayment}>
                    Continuă către rezumat <ChevronRight className={`${styles.icon4} ${styles.ml4}`} />
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>

            {/* REVIEW */}
            <TabsContent value="review">
              <Card className={styles.card}>
                <CardHeader>
                  <CardTitle className={styles.titleLg}>Rezumat final</CardTitle>
                </CardHeader>
                <CardContent className={styles.stackLg}>
                  <div className={styles.grid2}>
                    <div>
                      <div className={`${styles.textSm} ${styles.semi} ${styles.mbXs}`}>Livrare</div>
                      <div className={styles.textSm}>
                        {isPickup ? "Ridicare personală" : (
                          <>
                            <div>{shippingInfo.name || "-"}</div>
                            <div>{shippingInfo.phone || "-"}</div>
                            <div>{shippingInfo.street || "-"}, {shippingInfo.city || "-"}, {shippingInfo.county || "-"}</div>
                            <div>{shippingInfo.country || "-"} {shippingInfo.zip ? `• ${shippingInfo.zip}` : ""}</div>
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className={`${styles.textSm} ${styles.semi} ${styles.mbXs}`}>Plată</div>
                      <div className={styles.textSm}>
                        {paymentMethod === "card" ? "Card online" : "Ramburs (cash la livrare)"}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className={`${styles.textSm} ${styles.semi} ${styles.mbXs}`}>Produse</div>
                    <div className={styles.divideY}>
                      {items.map(it => (
                        <div key={it._id} className={styles.lineRow}>
                          <div className={`${styles.truncate} ${styles.textSm}`}>{it.title} × {it.qty}</div>
                          <div className={`${styles.textSm} ${styles.semi}`}>{currency(it.price * it.qty)}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={`${styles.row} ${styles.gapSm} ${styles.textSm}`}>
                    <input
                      id="accept-terms"
                      type="checkbox"
                      checked={acceptedTerms}
                      onChange={(e) => setAcceptedTerms(e.target.checked)}
                    />
                    <label htmlFor="accept-terms">
                      Confirm că am citit și accept <a href="/termeni" className={styles.link}>termenii și condițiile</a>.
                    </label>
                  </div>
                </CardContent>
                <CardFooter className={styles.rowBetween}>
                  <Button variant="ghost" onClick={() => setStep("payment")}>Înapoi</Button>
                  <Button className={styles.btnPrimary} onClick={placeOrder} disabled={!acceptedTerms || placing}>
                    {placing ? "Se procesează..." : "Plasează comanda"}
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>
          </div>

          {/* RIGHT (SIDEBAR) — doar la REVIEW */}
          <div className={styles.rightCol}>
            {step === "review" && (
              <SummaryCard
                merchandise={merchandiseTotal}
                discount={discount}
                vat={vatIncluded}
                shipping={isPickup ? 0 : shippingTotal}          // ✅ shipping corect
                shippingBreakdown={shippingBySeller}             // ✅ afișăm detaliile pe artizan
                total={grandTotal}
                isPickup={isPickup}
                setIsPickup={setIsPickup}
                styles={styles}
                ctaLabel="Plasează comanda"
                onCtaClick={placeOrder}
              />
            )}
          </div>
        </div>
      </Tabs>

      {items.length > 0 && <SavedForLater items={saveForLater} onAdd={addBackFromSFL} styles={styles} />}

      <Footer />
    </div>
  );
}

function EmptyCart({ styles }) {
  return (
    <div className={styles.empty}>
      <ShoppingCart className={styles.icon10} />
      <h3 className={styles.emptyTitle}>Coșul tău este gol</h3>
      <p className={styles.emptyText}>
        Descoperă creațiile artizanilor și adaugă produse în coș pentru a continua.
      </p>
      <Button className={styles.btnPrimary} onClick={() => { if (typeof window !== "undefined") window.location.href = "/"; }}>
        Vezi recomandările
      </Button>
    </div>
  );
}
