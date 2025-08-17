import React, { createContext, useContext, useId, useState } from "react";

const RadioCtx = createContext({
  name: "",
  value: undefined,
  setValue: () => {},
});

export function RadioGroup({ value, defaultValue, onValueChange, name, className, children }) {
  const [internal, setInternal] = useState(defaultValue);
  const isControlled = value !== undefined;
  const selected = isControlled ? value : internal;
  const setSelected = onValueChange ?? setInternal;

  // ✅ Hook la nivel de componentă, nu în callback
  const autoId = useId();
  const groupName = name || autoId;

  return (
    <div role="radiogroup" className={className}>
      <RadioCtx.Provider value={{ name: groupName, value: selected, setValue: setSelected }}>
        {children}
      </RadioCtx.Provider>
    </div>
  );
}

export function RadioGroupItem({ value, id, className = "", ...rest }) {
  const { name, value: selected, setValue } = useContext(RadioCtx);

  return (
    <input
      type="radio"
      id={id}
      name={name}
      value={value}
      checked={selected === value}
      onChange={() => setValue(value)}
      className={["sr-only", className].join(" ")}  // ascuns vizual, accesibil
      {...rest}
    />
  );
}
