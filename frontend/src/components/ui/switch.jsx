import React from "react";

export function Switch({ checked = false, onCheckedChange, className = "" }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange && onCheckedChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 items-center rounded-full transition",
        checked ? "bg-black" : "bg-gray-300",
        className
      ].join(" ")}
      type="button"
    >
      <span
        className={[
          "inline-block h-5 w-5 transform rounded-full bg-white transition",
          checked ? "translate-x-5" : "translate-x-1"
        ].join(" ")}
      />
    </button>
  );
}
