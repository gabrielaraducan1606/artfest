import React, { createContext, useContext, useId, useState } from "react";
import styles from "./radio-group.module.css";

const Ctx = createContext();

export function RadioGroup({ value, defaultValue, onValueChange, className = "", children, ...props }) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const selected = isControlled ? value : internal;

  const setSelected = (v) => {
    if (!isControlled) setInternal(v);
    onValueChange?.(v);
  };

  return (
    <Ctx.Provider value={{ selected, setSelected }}>
      <div role="radiogroup" className={`${styles.group} ${className}`} {...props}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function RadioGroupItem({ value, id: idProp, className = "", ...props }) {
  const { selected, setSelected } = useContext(Ctx);
  const id = useId();
  const isChecked = selected === value;

  return (
    <button
      role="radio"
      aria-checked={isChecked}
      id={idProp || `rg-${id}`}
      onClick={() => setSelected(value)}
      className={`${styles.item} ${isChecked ? styles.itemChecked : ""} ${className}`}
      {...props}
    />
  );
}

export default RadioGroup;
