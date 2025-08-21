import { useCallback, useEffect, useRef } from 'react';


export default function useDebouncedCallback(cb, delay){
const cbRef = useRef(cb);
const tRef = useRef(null);
useEffect(()=>{ cbRef.current = cb; }, [cb]);
useEffect(()=>()=>{ if(tRef.current) clearTimeout(tRef.current); },[]);
return useCallback((...args)=>{
if(tRef.current) clearTimeout(tRef.current);
tRef.current = setTimeout(()=> cbRef.current(...args), delay);
}, [delay]);
}