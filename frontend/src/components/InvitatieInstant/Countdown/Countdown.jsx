import { useEffect, useMemo, useState } from "react";
import styles from "./Countdown.module.css";

export default function Countdown({ data = {} }) {
  const target = useMemo(() => {
    const d = new Date(data?.date ?? "");
    return isNaN(d.getTime()) ? null : d;
  }, [data?.date]);

  const [remaining, setRemaining] = useState(() =>
    target ? target.getTime() - Date.now() : 0
  );

  useEffect(() => {
    if (!target) return;
    // resync imediat când se schimbă data
    setRemaining(target.getTime() - Date.now());
    const id = setInterval(() => {
      setRemaining(target.getTime() - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target) return null;

  const totalSec = Math.max(0, Math.floor(remaining / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  return (
    <div className={styles.countdown}>
      <span>{d}z</span><span>{h}h</span><span>{m}m</span><span>{s}s</span>
    </div>
  );
}
