import React from 'react';
import { Button } from "../../../components/ui/Button/Button";
import { Badge } from "../../../components/ui/badge/badge";
import { Trash2, Heart } from 'lucide-react';
import QtyControl from './QtyControl';
import { currency } from '../utils/currency';


export default function CartRow({ item, busy, onQty, onRemove, onSaveForLater, styles }){
const outOfStock = (item.stock ?? 1) <= 0;
return (
<div className={styles.itemRow}>
<img src={item.image || 'https://placehold.co/96x96'} alt={item.title || 'Produs handmade'} className={styles.itemImage}/>
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