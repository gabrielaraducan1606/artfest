import React from "react";

const variants = {
  default: "bg-black text-white hover:opacity-90",
  secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",
  ghost: "bg-transparent hover:bg-gray-100 text-gray-900",
};
const sizes = {
  default: "h-10 px-4 py-2",
  sm: "h-8 px-3 text-sm",
  lg: "h-11 px-6 text-base",
  icon: "h-10 w-10 p-0 flex items-center justify-center",
};

export function Button({ variant = "default", size = "default", className = "", ...props }) {
  const cls = [
    "inline-flex items-center justify-center rounded-2xl font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-300",
    variants[variant] || variants.default,
    sizes[size] || sizes.default,
    className
  ].join(" ");
  return <button className={cls} {...props} />;
}
