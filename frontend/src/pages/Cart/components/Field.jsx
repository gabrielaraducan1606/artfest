import React from 'react';


export default function Field({ label, error, children }){
return (
<div>
<div className="text-sm font-medium mb-1">{label}</div>
{children}
{error && <div className="text-xs text-red-600 mt-1">{error}</div>}
</div>
);
}