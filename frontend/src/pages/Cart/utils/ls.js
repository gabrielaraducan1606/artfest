const ls = {
getJSON(key, fallback){
try{ if(typeof window === 'undefined') return fallback; const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }catch{ return fallback; }
},
setJSON(key, val){
try{ if(typeof window !== 'undefined') localStorage.setItem(key, JSON.stringify(val)); }catch{""}
}
};
export default ls;