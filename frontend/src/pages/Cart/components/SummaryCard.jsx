import React from 'react';
import { Button } from "../../../components/ui/Button/Button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../../../components/ui/card/card";
import { Separator } from "../../../components/ui/separator/separator";
import { Switch } from "../../../components/ui/switch/switch";
import { Truck, ChevronRight } from 'lucide-react';
import { currency } from '../utils/currency';


const Row = ({ label, value, strong }) => (
<div className="flex items-center justify-between text-sm">
<span className={strong ? 'font-semibold' : ''}>{label}</span>
<span className={strong ? 'font-semibold' : ''}>{value}</span>
</div>
);


export default function SummaryCard({ merchandise, discount, vat, shipping, total,  styles, ctaLabel, onCtaClick }){
return (
<Card className={`${styles.card} ${styles.summaryCard}`}>
<CardHeader>
<CardTitle className="text-lg">Rezumat comandă</CardTitle>
</CardHeader>
<CardContent className="space-y-3">
<Row label="Produse" value={currency(merchandise)}/>
<Row label="Reduceri" value={discount ? `- ${currency(discount)}` : currency(0)}/>
<div className="flex items-center justify-between text-sm">

</div>
<Row label="Livrare" value={shipping ? currency(shipping) : 'Gratuit'}/>
<Row label="TVA (19%)" value={currency(vat)}/>
<Separator className={styles.summarySep}/>
<Row label="Total" value={currency(total)} strong/>
</CardContent>
<CardFooter>
<Button className={`w-full group ${styles.btnPrimary}`} onClick={onCtaClick}>
{ctaLabel} <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-0.5 transition"/>
</Button>
</CardFooter>
</Card>
);
}