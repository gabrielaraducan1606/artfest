import React from "react";

export const Textarea = React.forwardRef(function Textarea({ className = "", ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={["w-full rounded-xl border bg-white shadow-sm p-3 focus:outline-none focus:ring-2 focus:ring-gray-300", className].join(" ")}
      {...props}
    />
  );
});
