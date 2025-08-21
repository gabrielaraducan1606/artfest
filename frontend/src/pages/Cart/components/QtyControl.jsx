import React from 'react';
import { Button } from "../../../components/ui/Button/Button";
import { Input } from "../../../components/ui/input/input";
import { Loader2, Minus, Plus } from 'lucide-react';
import { clamp } from '../utils/currency';


export default function QtyControl({ value, onChange, busy, styles }){
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