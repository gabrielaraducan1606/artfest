import React from "react";

export default function Alert({ message, type = "info" }) {
  const base = "p-4 rounded text-sm font-medium";
  const types = {
    info: "bg-mint text-darkText",
    warning: "bg-yellow-100 text-yellow-800",
    danger: "bg-red-100 text-red-700",
    success: "bg-green-100 text-green-800",
  };

  return <div className={`${base} ${types[type]}`}>{message}</div>;
}
