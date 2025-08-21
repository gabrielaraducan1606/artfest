import { Package, ClipboardList } from 'lucide-react';
import React from 'react';


export default function Header({ styles }){
return (
<div className={styles.header}>
<div className="flex items-center gap-2 text-2xl font-semibold">
<Package className="w-6 h-6"/> Finalizează comanda
</div>
<div className={`flex items-center gap-3 text-xs md:text-sm ${styles.muted}`}>
<ClipboardList className="w-4 h-4"/> Pasul 1/3: Coș → Detalii → Plată
</div>
</div>
);
}