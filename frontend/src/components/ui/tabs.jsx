import React, { createContext, useContext, useMemo, useState } from "react";

const TabsCtx = createContext({ selected: "", setSelected: () => {} });

export function Tabs({ value, defaultValue, onValueChange, className, children }) {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const selected = value ?? internal;
  const setSelected = onValueChange ?? setInternal;

  const ctx = useMemo(() => ({ selected, setSelected }), [selected, setSelected]);
  return (
    <TabsCtx.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({ className, children, ...rest }) {
  return (
    <div role="tablist" className={className} {...rest}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, className = "", children, ...rest }) {
  const { selected, setSelected } = useContext(TabsCtx);
  const active = selected === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active ? "active" : "inactive"}
      onClick={() => setSelected(value)}
      className={[
        "px-3 py-2 text-sm border rounded-[var(--radius)] transition",
        "data-[state=active]:bg-[var(--color-primary)] data-[state=active]:text-white",
        className,
      ].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, className = "", children, ...rest }) {
  const { selected } = useContext(TabsCtx);
  const hidden = selected !== value;
  return (
    <div role="tabpanel" hidden={hidden} className={className} {...rest}>
      {!hidden && children}
    </div>
  );
}
