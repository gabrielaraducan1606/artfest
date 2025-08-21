import React, { useState } from "react";
import styles from "./switch.module.css";

export function Switch({ checked, onCheckedChange, className = "", ...props }) {
  const [internal, setInternal] = useState(!!checked);
  const isControlled = typeof checked === "boolean";
  const value = isControlled ? checked : internal;

  const toggle = () => {
    const next = !value;
    if (!isControlled) setInternal(next);
    onCheckedChange?.(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={toggle}
      className={`${styles.track} ${value ? styles.on : styles.off} ${className}`}
      {...props}
    >
      <span className={styles.thumb} />
    </button>
  );
}
export default Switch;
