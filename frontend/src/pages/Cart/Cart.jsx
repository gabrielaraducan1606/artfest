import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  ShoppingCart, Trash2, Tag, Truck, ShieldCheck, TicketPercent,
  Info, ChevronRight, Loader2, Package, Store, Plus, Minus,
  ClipboardList, Heart, AlertTriangle, CreditCard, Wallet
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

// utilitarul global axios cu baseURL: '/api'
import api from "../../components/services/api";

// CSS Module corect
import styles from "./Cart.module.css";

import Navbar from "../../components/HomePage/Navbar/Navbar";
import Footer from "../../components/HomePage/Footer/Footer";

const currency = (v) => new Intl.NumberFormat('ro-RO', { style:'currency', currency:'RON' }).format(v || 0);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function useDebouncedCallback(cb, delay){
  const [t, setT] = useState(null);
  return useCallback((...args)=>{
    if(t) clearTimeout(t);
    const id = setTimeout(()=>cb(...args), delay);
    setT(id);
  },[cb, delay, t]);
}

// mic helper pentru normalizare item
const normalizeItem = (row) => ({
  _id: row._id || row.id || row.productId?._id || row.productId,
  title: row.productId?.title || row.title || "Produs",
  price: row.productId?.price ?? row.price ?? 0,
  qty: row.qty ?? row.quantity ?? 1,
  image: row.productId?.images?.[0] || row.image,
  seller: row.productId?.seller || row.seller || null,
  stock: row.productId?.stock ?? row.stock ?? 999,
  attrs: row.productId?.attrs || row.attrs || {}
});

export default function Cart(){
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Sidebar (pas 1)
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [giftNote, setGiftNote] = useState("");

  // Checkout state
  const [step, setStep] = useState("cart"); // "cart" | "shipping" | "payment"
  const [shippingInfo, setShippingInfo] = useState({
    name: "", email: "", phone: "",
    country: "România", county: "", city: "", street: "", zip: ""
  });
  const [shippingErrors, setShippingErrors] = useState({});
  const [paymentMethod, setPaymentMethod] = useState("card"); // "card" | "cod"
  const [isPickup, setIsPickup] = useState(false);

  // Helpers
  const [saveForLater, setSaveForLater] = useState([]);
  const [busyIds, setBusyIds] = useState(new Set());
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;

  useEffect(()=>{
    let mounted = true;
    (async()=>{
      try{
        setLoading(true);

        if (!token) {
          const localCart = JSON.parse(localStorage.getItem('cart') || '[]');
          if (!mounted) return;
          setItems(localCart.map(normalizeItem));
          const sfl = JSON.parse(localStorage.getItem("sfl")||"[]");
          setSaveForLater(sfl);
          setError("");
          return;
        }

        const data = await api.get("/cart").then(r => r.data ?? r);
        if(!mounted) return;
        const normalized = (Array.isArray(data) ? data : []).map(normalizeItem);
        setItems(normalized);
        const sfl = JSON.parse(localStorage.getItem("sfl")||"[]");
        setSaveForLater(sfl);
        setError("");
      }catch(e){
        console.error(e);
        setError("Nu am putut încărca coșul.");
      }finally{
        setLoading(false);
      }
    })();
    return ()=>{ mounted = false; };
  },[token]);

  const groupedBySeller = useMemo(()=>{
    const map = new Map();
    for(const it of items){
      const sellerId = it.seller?._id || "fara-seller";
      const sellerName = it.seller?.name || "Artizan";
      const key = sellerId + "|" + sellerName;
      if(!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return Array.from(map.entries()).map(([key,list])=>{
      const [sellerId, sellerName] = key.split("|");
      return { sellerId, sellerName, list };
    });
  },[items]);

  const merchandiseTotal = useMemo(()=> items.reduce((s,it)=> s + it.price * it.qty, 0), [items]);
  const discount = useMemo(()=>{
    if(!appliedCoupon) return 0;
    const pct = appliedCoupon.type === "percent" ? appliedCoupon.value : 0;
    const fix = appliedCoupon.type === "fixed" ? appliedCoupon.value : 0;
    return Math.min(merchandiseTotal * (pct/100) + fix, merchandiseTotal);
  },[appliedCoupon, merchandiseTotal]);
  const vatRate = 0.19;
  const vat = useMemo(()=> (merchandiseTotal - discount) * vatRate, [merchandiseTotal, discount]);
  const shipping = useMemo(()=> {
    if(isPickup) return 0;
    return (merchandiseTotal - discount) >= 250 ? 0 : 19.99;
  }, [isPickup, merchandiseTotal, discount]);
  const grandTotal = useMemo(()=> Math.max(0, merchandiseTotal - discount + vat + shipping), [merchandiseTotal, discount, vat, shipping]);

  const writeLocal = (next) => localStorage.setItem('cart', JSON.stringify(next));

  const setQty = useCallback(async (id, nextQty)=>{
    nextQty = clamp(nextQty, 1, 999);
    setBusyIds(prev => new Set(prev).add(id));
    setItems(prev => prev.map(it => it._id===id ? { ...it, qty: nextQty } : it));

    if (!token) {
      const after = (prev => prev.map(it => it._id===id ? { ...it, qty: nextQty } : it))(items);
      writeLocal(after);
      setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      return;
    }

    try{
      await api.patch(`/cart/${id}`, { qty: nextQty });
    }catch(e){
      console.error(e);
      setError("Nu am putut actualiza cantitatea.");
    }finally{
      setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  },[items, token]);
  const debouncedQty = useDebouncedCallback(setQty, 350);

  const removeItem = useCallback(async (id)=>{
    setBusyIds(prev => new Set(prev).add(id));
    const snapshot = items;
    const after = items.filter(it => it._id!==id);
    setItems(after);

    if (!token) {
      writeLocal(after);
      setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      return;
    }

    try{
      await api.delete(`/cart/${id}`);
    }catch(e){
      console.error(e);
      setItems(snapshot);
      setError("Nu am putut șterge produsul.");
    }finally{
      setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  },[items, token]);

  const applyCoupon = useCallback(async ()=>{
    if(!coupon?.trim()) return;
    try{
      const res = await api.post("/cart/apply-coupon", { code: coupon.trim() });
      const payload = res.data ?? res;
      if(payload?.ok){
        setAppliedCoupon(payload.coupon);
      }else{
        setAppliedCoupon(null);
        setError(payload?.message || "Cupon invalid.");
      }
    }catch(e){
      console.error(e);
      setError("Eroare la aplicarea cuponului.");
    }
  },[coupon]);

  const moveToSFL = useCallback((id)=>{
    const it = items.find(x=>x._id===id);
    if(!it) return;
    const rest = items.filter(x=>x._id!==id);
    const next = [it, ...saveForLater.filter(x=>x._id!==id)];
    setItems(rest);
    setSaveForLater(next);
    localStorage.setItem('sfl', JSON.stringify(next));
    if (!token) writeLocal(rest);
  },[items, saveForLater, token]);

  const addBackFromSFL = useCallback(async(id)=>{
    const it = saveForLater.find(x=>x._id===id);
    if(!it) return;

    if (!token) {
      const next = [it, ...items];
      setItems(next);
      writeLocal(next);
      const rest = saveForLater.filter(x=>x._id!==id);
      setSaveForLater(rest);
      localStorage.setItem('sfl', JSON.stringify(rest));
      return;
    }

    try{
      await api.post('/cart', { productId: id, qty: it.qty || 1 });
      setItems(prev => [it, ...prev]);
      const rest = saveForLater.filter(x=>x._id!==id);
      setSaveForLater(rest);
      localStorage.setItem('sfl', JSON.stringify(rest));
    }catch(e){
      console.error(e);
      setError('Nu am putut adăuga produsul în coș.');
    }
  },[saveForLater, items, token]);

  const clearCart = useCallback(async()=>{
    const current = [...items];
    setItems([]);
    if (!token) { writeLocal([]); return; }
    try{
      const res = await api.delete('/cart');
      const ok = (res.data ?? res)?.ok ?? true;
      if(!ok) throw new Error('fallback');
    }catch(e){
      console.warn('fallback clear per-item', e?.message);
      await Promise.all(current.map(it=>api.delete(`/cart/${it._id}`).catch(()=>null)));
    }
  },[items, token]);

  // ======== checkout helpers (tabs) ========
  const isEmpty = items.length===0;

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

  const goNextFromCart = () => {
    if (isEmpty) return;
    setStep("shipping");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goNextFromShipping = () => {
    if (!validateShipping()) return;
    setStep("payment");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const placeOrder = async () => {
    try{
      const payload = {
        items: items.map(it => ({ productId: it._id, qty: it.qty })),
        coupon: appliedCoupon?.code || null,
        note: giftNote || "",
        shipping: {
          method: isPickup ? "pickup" : "courier",
          cost: shipping,
          address: isPickup ? null : shippingInfo
        },
        payment: { method: paymentMethod },
        totals: {
          merchandise: merchandiseTotal,
          discount,
          vat,
          shipping,
          total: grandTotal
        }
      };
      const res = await api.post("/orders", payload).then(r=>r.data ?? r);
      // navighează în pagina de confirmare (ajustează după backend)
      if (res?.orderId) window.location.href = `/order/${res.orderId}`;
      else window.location.href = `/checkout/success`;
    }catch(e){
      console.error(e);
      setError("Nu am putut plasa comanda. Încearcă din nou.");
    }
  };

  // ======== UI ========
  if(loading){
    return (
      <div className={styles.container}>
        <SkeletonHeader/>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
          <Card className={`lg:col-span-2 p-4 space-y-4 ${styles.card}`}>
            {Array.from({length:4}).map((_,i)=> <SkeletonRow key={i}/>) }
          </Card>
          <Card className={`p-4 h-fit space-y-3 ${styles.card}`}>
            <div className="h-6 w-40 bg-gray-200 rounded"/>
            <div className="h-8 w-full bg-gray-200 rounded"/>
            <div className="h-8 w-full bg-gray-200 rounded"/>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <Navbar />
      <Header/>

      {error && (
        <div className={styles.alert}>
          <AlertTriangle className="w-5 h-5"/>
          <span className="text-sm">{error}</span>
        </div>
      )}

      <Tabs value={step} onValueChange={(v)=>{
        // blochează accesul direct la tab-urile următoare dacă nu ai produse
        if (isEmpty && v !== "cart") return;
        setStep(v);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }} className="mt-4">
        <TabsList className="grid grid-cols-3">
          <TabsTrigger value="cart">Coș</TabsTrigger>
          <TabsTrigger
            value="shipping"
            disabled={isEmpty}
            className={isEmpty ? "pointer-events-none opacity-50" : ""}
          >
            Detalii livrare
          </TabsTrigger>
          <TabsTrigger
            value="payment"
            disabled={isEmpty}
            className={isEmpty ? "pointer-events-none opacity-50" : ""}
          >
            Plată
          </TabsTrigger>
        </TabsList>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
          {/* LEFT COLUMN */}
          <div className="lg:col-span-2 space-y-6">
            {/* PASUL 1: COȘ */}
            <TabsContent value="cart">
              <Card className={`${styles.card} ${styles.listCard}`}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <ShoppingCart className="w-5 h-5"/> Coșul tău
                  </CardTitle>
                  {items.length > 0 && (
                    <Button variant="ghost" onClick={clearCart} className={`text-sm ${styles.btnGhost}`}>Golește coșul</Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-6">
                  {items.length === 0 ? (
                    <EmptyCart styles={styles}/>
                  ) : (
                    groupedBySeller.map(group => (
                      <div key={group.sellerId} className={styles.sellerGroup}>
                        <div className="flex items-center gap-2 mb-3">
                          <Store className="w-4 h-4"/>
                          <span className="font-medium">{group.sellerName}</span>
                        </div>
                        <Separator/>
                        <div className="divide-y">
                          {group.list.map(it => (
                            <CartRow
                              key={it._id}
                              item={it}
                              busy={busyIds.has(it._id)}
                              onQty={(q)=>debouncedQty(it._id, q)}
                              onRemove={()=>removeItem(it._id)}
                              onSaveForLater={()=>moveToSFL(it._id)}
                              styles={styles}
                            />
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
                {items.length > 0 && (
                  <CardFooter className="flex flex-col gap-3">
                    <div className="w-full flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <ShieldCheck className="w-4 h-4"/> Protecție cumpărături: retur ușor 14 zile.
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Truck className="w-4 h-4"/> {shipping===0 ? 'Livrare gratuită' : `Livrare estimată: ${currency(shipping)}`}
                      </div>
                    </div>
                    <div className="flex gap-3 justify-end">
                      <Button className={styles.btnPrimary} onClick={goNextFromCart}>
                        Continuă către detalii <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </CardFooter>
                )}
              </Card>

              {items.length > 0 && (
                <Card className={styles.card}>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2"><TicketPercent className="w-4 h-4"/> Cupon</CardTitle>
                  </CardHeader>
                  <CardContent className="flex gap-2">
                    <Input placeholder="Ex: WELCOME10" value={coupon} onChange={(e)=>setCoupon(e.target.value)} aria-label="Cod cupon"/>
                    <Button onClick={applyCoupon} className={`whitespace-nowrap ${styles.btnPrimary}`}>Aplică</Button>
                  </CardContent>
                  {appliedCoupon && (
                    <CardFooter className={`${styles.couponFooter} text-sm`}>
                      <Tag className="w-4 h-4 mr-2"/> Cupon activ: <b className="ml-1">{appliedCoupon.code}</b>
                    </CardFooter>
                  )}
                </Card>
              )}
            </TabsContent>

            {/* PASUL 2: DETALII LIVRARE */}
            <TabsContent value="shipping">
              <Card className={styles.card}>
                <CardHeader>
                  <CardTitle className="text-lg">Detalii livrare & contact</CardTitle>
                </CardHeader>
                <CardContent className="grid md:grid-cols-2 gap-4">
                  <Field label="Nume complet" error={shippingErrors.name}>
                    <Input value={shippingInfo.name} onChange={e=>setShippingInfo(s=>({...s, name:e.target.value}))}/>
                  </Field>
                  <Field label="Telefon" error={shippingErrors.phone}>
                    <Input value={shippingInfo.phone} onChange={e=>setShippingInfo(s=>({...s, phone:e.target.value}))}/>
                  </Field>
                  <Field label="Email (opțional)">
                    <Input type="email" value={shippingInfo.email} onChange={e=>setShippingInfo(s=>({...s, email:e.target.value}))}/>
                  </Field>
                  <div className="flex items-center justify-between text-sm md:col-span-2">
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4"/>
                      <span>Ridicare personală</span>
                    </div>
                    <Switch checked={isPickup} onCheckedChange={setIsPickup} />
                  </div>

                  {!isPickup && (
                    <>
                      <Field label="Țară">
                        <Input value={shippingInfo.country} onChange={e=>setShippingInfo(s=>({...s, country:e.target.value}))}/>
                      </Field>
                      <Field label="Județ">
                        <Input value={shippingInfo.county} onChange={e=>setShippingInfo(s=>({...s, county:e.target.value}))}/>
                      </Field>
                      <Field label="Oraș" error={shippingErrors.city}>
                        <Input value={shippingInfo.city} onChange={e=>setShippingInfo(s=>({...s, city:e.target.value}))}/>
                      </Field>
                      <Field label="Stradă, număr" error={shippingErrors.street}>
                        <Input value={shippingInfo.street} onChange={e=>setShippingInfo(s=>({...s, street:e.target.value}))}/>
                      </Field>
                      <Field label="Cod poștal" error={shippingErrors.zip}>
                        <Input value={shippingInfo.zip} onChange={e=>setShippingInfo(s=>({...s, zip:e.target.value}))}/>
                      </Field>
                    </>
                  )}

                  <div className="md:col-span-2">
                    <Field label="Mesaj pentru artizan (opțional)">
                      <Textarea rows={3} placeholder="Ex: ambalare cadou, detalii personalizare..." value={giftNote} onChange={e=>setGiftNote(e.target.value)} />
                    </Field>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-between">
                  <Button variant="ghost" onClick={()=>setStep("cart")}>Înapoi la coș</Button>
                  <Button className={styles.btnPrimary} onClick={goNextFromShipping}>
                    Continuă către plată <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>

            {/* PASUL 3: PLATĂ */}
            <TabsContent value="payment">
              <Card className={styles.card}>
                <CardHeader>
                  <CardTitle className="text-lg">Metodă de plată</CardTitle>
                </CardHeader>
                <CardContent>
                  <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod} className="grid gap-3">
                    <label className="flex items-center gap-3 border rounded-2xl p-3 cursor-pointer">
                      <RadioGroupItem value="card" id="pm-card"/>
                      <CreditCard className="w-4 h-4"/>
                      <span>Card online</span>
                    </label>
                    <label className="flex items-center gap-3 border rounded-2xl p-3 cursor-pointer">
                      <RadioGroupItem value="cod" id="pm-cod"/>
                      <Wallet className="w-4 h-4"/>
                      <span>Ramburs (cash la livrare)</span>
                    </label>
                  </RadioGroup>
                </CardContent>
                <CardFooter className="flex justify-between">
                  <Button variant="ghost" onClick={()=>setStep("shipping")}>Înapoi</Button>
                  <Button className={styles.btnPrimary} onClick={placeOrder}>
                    Plasează comanda
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>
          </div>

          {/* RIGHT COLUMN (SIDEBAR) */}
          <div className="space-y-6">
            {items.length > 0 && step === "cart" && (
              <CouponCard
                coupon={coupon}
                setCoupon={setCoupon}
                applyCoupon={applyCoupon}
                applied={appliedCoupon}
                styles={styles}
              />
            )}
            {items.length > 0 && (
              <SummaryCard
                merchandise={merchandiseTotal}
                discount={discount}
                vat={vat}
                shipping={shipping}
                total={grandTotal}
                isPickup={isPickup}
                setIsPickup={setIsPickup}
                styles={styles}
                // CTA context-aware
                ctaLabel={step === "payment" ? "Plasează comanda" : step === "shipping" ? "Continuă către plată" : "Continuă către detalii"}
                onCtaClick={step === "payment" ? placeOrder : step === "shipping" ? goNextFromShipping : goNextFromCart}
              />
            )}
          </div>
        </div>
      </Tabs>

      {items.length > 0 && <SavedForLater items={saveForLater} onAdd={addBackFromSFL}/>}

      <Footer />
    </div>
  );
}

// ========== SUBCOMPONENTE ==========

function Header(){
  return (
    <div className={styles.header}>
      <div className="flex items-center gap-2 text-2xl font-semibold">
        <Package className="w-6 h-6"/> Finalizează comanda
      </div>
      <div className={`flex items-center gap-3 text-xs md:text-sm ${styles.muted}`}>
        <ClipboardList className="w-4 h-4"/> Pasul 1/3: Coș → Adresă & Livrare → Plată
      </div>
    </div>
  );
}

function Field({ label, error, children }){
  return (
    <div>
      <div className="text-sm font-medium mb-1">{label}</div>
      {children}
      {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
    </div>
  );
}

function SkeletonHeader(){ return (<div className="flex items-center justify-between"><div className="h-8 w-64 bg-gray-200 rounded"/><div className="h-5 w-56 bg-gray-200 rounded"/></div>); }
function SkeletonRow(){ return (<div className="flex gap-3 items-center py-3"><div className="w-16 h-16 bg-gray-200 rounded-xl"/><div className="flex-1 space-y-2"><div className="h-4 w-1/2 bg-gray-200 rounded"/><div className="h-4 w-1/3 bg-gray-200 rounded"/></div><div className="w-24 h-10 bg-gray-200 rounded"/><div className="w-20 h-6 bg-gray-200 rounded"/></div>); }

function QtyControl({ value, onChange, busy, styles }){
  return (
    <div className={`${styles.qtyWrap} inline-flex items-center`}>
      <Button type="button" variant="ghost" size="icon" aria-label="Scade" onClick={()=>onChange(clamp(value-1,1,999))}>
        <Minus className="w-4 h-4"/>
      </Button>
      <Input inputMode="numeric" aria-label="Cantitate" className={`${styles.qtyInput} w-14 text-center`} value={value} onChange={(e)=>onChange(Number(e.target.value)||1)} />
      <Button type="button" variant="ghost" size="icon" aria-label="Crește" onClick={()=>onChange(clamp(value+1,1,999))}>
        <Plus className="w-4 h-4"/>
      </Button>
      {busy && <Loader2 className={`w-4 h-4 animate-spin ${styles.loader}`}/>}
    </div>
  );
}

function CartRow({ item, busy, onQty, onRemove, onSaveForLater, styles }){
  const outOfStock = (item.stock ?? 1) <= 0;
  return (
    <div className={styles.itemRow}>
      <img src={item.image || 'https://placehold.co/96x96'} alt="Produs" className={styles.itemImage}/>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`${styles.itemTitle} truncate`}>{item.title}</span>
          {outOfStock && <Badge variant="destructive">Stoc epuizat</Badge>}
        </div>
        <div className={`text-sm text-muted-foreground ${styles.attrs}`}>
          {item.attrs && Object.entries(item.attrs).map(([k,v])=> (
            <span key={k} className={styles.attrPill}>{k}: {String(v)}</span>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <QtyControl value={item.qty} onChange={onQty} busy={busy} styles={styles}/>
          <Button variant="ghost" size="sm" onClick={onSaveForLater} className={`text-muted-foreground ${styles.btnGhost}`}>
            <Heart className="w-4 h-4 mr-1"/> Salvează pentru mai târziu
          </Button>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2 ml-auto">
        <div className={`text-lg ${styles.price}`}>{currency(item.price * item.qty)}</div>
        <Button variant="ghost" size="icon" aria-label="Șterge" onClick={onRemove}>
          <Trash2 className="w-5 h-5"/>
        </Button>
      </div>
    </div>
  );
}

function CouponCard({ coupon, setCoupon, applyCoupon, applied, styles }){
  return (
    <Card className={styles.card}>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><TicketPercent className="w-4 h-4"/> Cupon</CardTitle>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Input placeholder="Ex: WELCOME10" value={coupon} onChange={(e)=>setCoupon(e.target.value)} aria-label="Cod cupon"/>
        <Button onClick={applyCoupon} className={`whitespace-nowrap ${styles.btnPrimary}`}>Aplică</Button>
      </CardContent>
      {applied && (
        <CardFooter className={`${styles.couponFooter} text-sm`}>
          <Tag className="w-4 h-4 mr-2"/> Cupon activ: <b className="ml-1">{applied.code}</b>
        </CardFooter>
      )}
    </Card>
  );
}

function SummaryRow({ label, value, strong }){
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={strong ? 'font-semibold' : ''}>{label}</span>
      <span className={strong ? 'font-semibold' : ''}>{value}</span>
    </div>
  );
}

function SummaryCard({ merchandise, discount, vat, shipping, total, isPickup, setIsPickup, styles, ctaLabel, onCtaClick }){
  return (
    <Card className={`${styles.card} ${styles.summaryCard}`}>
      <CardHeader>
        <CardTitle className="text-lg">Rezumat comandă</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <SummaryRow label="Produse" value={currency(merchandise)}/>
        <SummaryRow label="Reduceri" value={discount ? `- ${currency(discount)}` : currency(0)}/>
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4"/>
            <span>Ridicare personală</span>
          </div>
          <Switch checked={isPickup} onCheckedChange={setIsPickup} />
        </div>
        <SummaryRow label="Livrare" value={shipping ? currency(shipping) : 'Gratuit'}/>
        <SummaryRow label="TVA (19%)" value={currency(vat)}/>
        <Separator className={styles.summarySep}/>
        <SummaryRow label="Total" value={currency(total)} strong/>
      </CardContent>
      <CardFooter>
        <Button className={`w-full group ${styles.btnPrimary}`} onClick={onCtaClick}>
          {ctaLabel} <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-0.5 transition"/>
        </Button>
      </CardFooter>
    </Card>
  );
}

function SavedForLater({ items, onAdd }){
  if(!items?.length) return null;
  return (
    <div className="max-w-6xl mx-auto mt-8">
      <Card className={styles.card}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Heart className="w-4 h-4"/> Salvate pentru mai târziu</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          {items.map(it => (
            <div key={it._id} className="flex items-center gap-3 p-3 rounded-2xl border">
              <img src={it.image || 'https://placehold.co/64x64'} alt="" className="w-16 h-16 rounded-xl object-cover"/>
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{it.title}</div>
                <div className="text-sm text-muted-foreground">{currency(it.price)}</div>
              </div>
              <Button size="sm" onClick={()=>onAdd(it._id)}>Adaugă în coș</Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyCart({ styles }){
  return (
    <div className={styles.empty}>
      <ShoppingCart className="w-10 h-10 text-muted-foreground"/>
      <h3 className={styles.emptyTitle}>Coșul tău este gol</h3>
      <p className={`text-sm text-muted-foreground ${styles.emptyText}`}>Descoperă creațiile artizanilor și adaugă produse în coș pentru a continua.</p>
      <Button className={styles.btnPrimary} onClick={()=>window.location.href='/'}>Vezi recomandările</Button>
    </div>
  );
}
