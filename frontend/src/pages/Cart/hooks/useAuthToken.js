import { useEffect, useState } from 'react';


export default function useAuthToken(){
const [token, setToken] = useState(()=> (typeof window !== 'undefined' ? localStorage.getItem('authToken') : null));
useEffect(()=>{
if(typeof window === 'undefined') return;
const handler = (e)=>{ if(e.key === 'authToken') setToken(e.newValue); };
window.addEventListener('storage', handler);
return ()=> window.removeEventListener('storage', handler);
},[]);
return token;
}