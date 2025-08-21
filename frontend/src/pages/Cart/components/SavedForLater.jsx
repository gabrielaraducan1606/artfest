import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card/card";
import { Button } from "../../../components/ui/Button/Button";
import { Heart } from 'lucide-react';
import { currency } from '../utils/currency';


export default function SavedForLater({ items, onAdd, styles }){
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