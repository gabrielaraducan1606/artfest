import { useEffect, useState } from "react";

export function useTypeCycle(words, { delay = 1600 } = {}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!Array.isArray(words) || words.length < 2) return;
    const id = setInterval(() => setI((v) => (v + 1) % words.length), delay);
    return () => clearInterval(id);
  }, [words, delay]);
  return words?.[i] || "";
}
