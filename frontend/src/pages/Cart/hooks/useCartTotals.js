import { useMemo } from 'react';


export default function useCartTotals(items, appliedCoupon, isPickup){
const merchandiseTotal = useMemo(()=> items.reduce((s,it)=> s + it.price * it.qty, 0), [items]);
const discount = useMemo(()=>{
if(!appliedCoupon) return 0;
const pct = appliedCoupon.type === 'percent' ? appliedCoupon.value : 0;
const fix = appliedCoupon.type === 'fixed' ? appliedCoupon.value : 0;
return Math.min(merchandiseTotal * (pct/100) + fix, merchandiseTotal);
},[appliedCoupon, merchandiseTotal]);
const vatRate = 0.19;
const vat = useMemo(()=> (merchandiseTotal - discount) * vatRate, [merchandiseTotal, discount]);
const shipping = useMemo(()=> {
if(isPickup) return 0;
return (merchandiseTotal - discount) >= 250 ? 0 : 19.99;
}, [isPickup, merchandiseTotal, discount]);
const grandTotal = useMemo(()=> Math.max(0, merchandiseTotal - discount + vat + shipping), [merchandiseTotal, discount, vat, shipping]);
return { merchandiseTotal, discount, vat, shipping, grandTotal };
}