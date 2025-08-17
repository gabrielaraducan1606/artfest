import React from "react";

export const Input = React.forwardRef(function Input({ className = "", ...props }, ref) {
  return (
    <input
      ref={ref}
      className={["h-10 px-3 rounded-xl border bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-300", className].join(" ")}
      {...props}
    />
  );
});
