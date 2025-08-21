import React from 'react';
import { Button } from "../../../components/ui/Button/Button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../../../components/ui/card/card";
import { Input } from "../../../components/ui/input/input";
import { Tag, TicketPercent } from 'lucide-react';


export default function CouponCard({ coupon, setCoupon, applyCoupon, applied, styles }){
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