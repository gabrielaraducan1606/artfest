import React, { createContext, useContext, useState } from "react";
import styles from "./tabs.module.css";

const TabsCtx = createContext(null);

export function Tabs({ value, defaultValue = "cart", onValueChange, className = "", children, ...props }) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const current = controlled ? value : internal;
  const setCurrent = (v) => { if (!controlled) setInternal(v); onValueChange?.(v); };

  return (
    <TabsCtx.Provider value={{ current, setCurrent }}>
      <div className={`${styles.tabs} ${className}`} {...props}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({ className = "", children, ...props }) {
  return (
    <div className={`${styles.list} ${className}`} role="tablist" {...props}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, disabled, className = "", children, ...props }) {
  const { current, setCurrent } = useContext(TabsCtx);
  const selected = current === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={`panel-${value}`}
      disabled={disabled}
      tabIndex={selected ? 0 : -1}
      onClick={() => setCurrent(value)}
      className={`${styles.trigger} ${selected ? styles.triggerActive : ""} ${disabled ? styles.triggerDisabled : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, className = "", children, ...props }) {
  const { current } = useContext(TabsCtx);
  if (current !== value) return null;
  return (
    <div id={`panel-${value}`} role="tabpanel" className={`${styles.content} ${className}`} {...props}>
      {children}
    </div>
  );
}

export default Tabs;
