import React from "react";

export default function Badge({ label }) {
  return (
    <span className="px-3 py-1 bg-pinkSoft text-darkText text-xs rounded-full">
      {label}
    </span>
  );
}
