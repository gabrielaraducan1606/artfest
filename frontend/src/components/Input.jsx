import { useState } from "react";

export function TextInput({ value, onChange, ...p }) {
  return <input value={value ?? ""} onChange={e=>onChange(e.target.value)} {...p} />;
}
export function TextArea({ value, onChange, ...p }) {
  return <textarea value={value ?? ""} onChange={e=>onChange(e.target.value)} {...p} />;
}
export function NumberInput({ value, onChange, ...p }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      pattern="[0-9]*"
      value={value ?? ""}
      onChange={e=>onChange(e.target.value === "" ? "" : Number(e.target.value))}
      {...p}
    />
  );
}
export function Checkbox({ checked, onChange, label }) {
  return <label style={{ display:"flex", gap:8, alignItems:"center" }}>
    <input type="checkbox" checked={!!checked} onChange={e=>onChange(e.target.checked)} /> {label}
  </label>;
}
export function RadioGroup({ value, onChange, options=[] }) {
  return <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
    {options.map(o=>(
      <label key={o} style={{ display:"flex", gap:6, alignItems:"center" }}>
        <input type="radio" checked={value===o} onChange={()=>onChange(o)} /> {o}
      </label>
    ))}
  </div>;
}
export function Dropdown({ value, onChange, options=[], placeholder }) {
  return <select value={value ?? ""} onChange={e=>onChange(e.target.value)} >
    <option value="">{placeholder || "Selectează..."}</option>
    {options.map(o=> <option key={o} value={o}>{o}</option>)}
  </select>;
}
export function DropdownAdd({ value, onChange, options=[], placeholder }) {
  const [custom, setCustom] = useState("");
  return (
    <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
      <Dropdown value={value} onChange={onChange} options={options} placeholder={placeholder} />
      <input placeholder="Adaugă opțiune" value={custom} onChange={e=>setCustom(e.target.value)} />
      <button type="button" onClick={()=>{
        if (custom) { onChange(custom); setCustom(""); }
      }}>Adaugă</button>
    </div>
  );
}
export function Checklist({ values=[], onChange, options=[] }) {
  const set = new Set(values||[]);
  const toggle = (x)=>{ const s=new Set(set); s.has(x)?s.delete(x):s.add(x); onChange(Array.from(s)); };
  return <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
    {options.map(o=>(
      <label key={o} style={{ border:"1px solid #ddd", borderRadius:8, padding:"4px 8px" }}>
        <input type="checkbox" checked={set.has(o)} onChange={()=>toggle(o)} /> {o}
      </label>
    ))}
  </div>;
}
export function ChecklistAdd({ values=[], onChange, options=[] }) {
  const [custom, setCustom] = useState("");
  return (
    <div style={{ display:"grid", gap:8 }}>
      <Checklist values={values} onChange={onChange} options={options} />
      <div style={{ display:"flex", gap:8 }}>
        <input placeholder="Adaugă element" value={custom} onChange={e=>setCustom(e.target.value)} />
        <button type="button" onClick={()=>{
          if (custom) { onChange([...(values||[]), custom]); setCustom(""); }
        }}>Adaugă</button>
      </div>
    </div>
  );
}
export function LinksList({ value=[], onChange }) {
  const add = () => onChange([...(value||[]), ""]);
  const set = (i,v) => onChange(value.map((x,idx)=>idx===i?v:x));
  const rm = (i) => onChange(value.filter((_,idx)=>idx!==i));
  const normalize = (url) => {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return url;
    return `https://${url}`;
  };
  return (
    <div style={{ display:"grid", gap:6 }}>
      {(value||[]).map((v,i)=>(
        <div key={i} style={{ display:"flex", gap:6 }}>
          <input
            placeholder="https://..."
            value={v}
            onChange={e=>set(i,e.target.value)}
            onBlur={e=>set(i, normalize(e.target.value))}
            style={{ flex:1 }}
          />
          <button type="button" onClick={()=>rm(i)}>−</button>
        </div>
      ))}
      <button type="button" onClick={add}>+ adaugă link</button>
    </div>
  );
}
export function ListText({ value=[], onChange, placeholder="valoare" }) {
  const add=()=>onChange([...(value||[]), ""]);
  const set=(i,v)=>onChange(value.map((x,idx)=>idx===i?v:x));
  const rm=(i)=>onChange(value.filter((_,idx)=>idx!==i));
  return (
    <div style={{ display:"grid", gap:6 }}>
      {(value||[]).map((v,i)=>(
        <div key={i} style={{ display:"flex", gap:6 }}>
          <input placeholder={placeholder} value={v} onChange={e=>set(i,e.target.value)} style={{ flex:1 }} />
          <button type="button" onClick={()=>rm(i)}>−</button>
        </div>
      ))}
      <button type="button" onClick={add}>+ adaugă</button>
    </div>
  );
}
export function ItemsList({ value=[], onChange, schema=[] }) {
  const add=()=>onChange([...(value||[]), {}]);
  const rm=(i)=>onChange(value.filter((_,idx)=>idx!==i));
  const set=(i,patch)=>onChange(value.map((x,idx)=>idx===i?{...x,...patch}:x));
  return (
    <div style={{ display:"grid", gap:10 }}>
      {(value||[]).map((item,i)=>(
        <div key={i} style={{ border:"1px solid #eee", borderRadius:8, padding:10 }}>
          {schema.map(f=>{
            const val = item[f.key];
            const onCh = (nv)=>set(i,{ [f.key]: nv });
            return (
              <div key={f.key} style={{ marginBottom:8 }}>
                <div style={{ fontSize:12, color:"#666" }}>{f.label}</div>
                {f.type==="text" && <TextInput value={val} onChange={onCh} />}
                {f.type==="textarea" && <TextArea value={val} onChange={onCh} />}
                {f.type==="number" && <NumberInput value={val} onChange={onCh} />}
                {f.type==="list_text" && <ListText value={val} onChange={onCh} />}
              </div>
            );
          })}
          <button type="button" onClick={()=>rm(i)}>Șterge</button>
        </div>
      ))}
      <button type="button" onClick={add}>+ adaugă element</button>
    </div>
  );
}
export function NumberRange({ value=[0,0], onChange }) {
  const [min,max] = value || ["",""];
  return (
    <div style={{ display:"flex", gap:8 }}>
      <NumberInput value={min} onChange={v=>onChange([v, max])} placeholder="min" />
      <NumberInput value={max} onChange={v=>onChange([min, v])} placeholder="max" />
    </div>
  );
}
