import React from "react";

const variants = {
  default: "bg-gray-900 text-white",
  secondary: "bg-gray-100 text-gray-900",
  destructive: "bg-red-600 text-white",
  outline: "border",
};

export function Badge({ variant = "default", className = "", ...props }) {
  const cls = ["inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", variants[variant] || variants.default, className].join(" ");
  return <span className={cls} {...props} />;
}
