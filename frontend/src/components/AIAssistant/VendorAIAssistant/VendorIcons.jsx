// src/components/AIAssistant/Vendor/VendorIcons.jsx

import React from "react";

/* =========================================================
   Helper comun
========================================================= */

function IconBase({
  children,
  size = 22,
  className = "",
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* =========================================================
   Produse
========================================================= */

export function VendorProductsIcon(
  props
) {
  return (
    <IconBase {...props}>
      <path
        d="M4 7.5L12 3L20 7.5V16.5L12 21L4 16.5V7.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      <path
        d="M4.5 7.7L12 12L19.5 7.7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      <path
        d="M12 12V20.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </IconBase>
  );
}

/* =========================================================
   Adaugă produs
========================================================= */

export function VendorAddIcon(
  props
) {
  return (
    <IconBase {...props}>
      <path
        d="M4 7.5L12 3L20 7.5V16.5L12 21L4 16.5V7.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />

      <path
        d="M4.5 7.7L12 12L19.5 7.7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />

      <path
        d="M12 12V20.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />

      <circle
        cx="18"
        cy="6"
        r="4"
        fill="currentColor"
      />

      <path
        d="M18 4.2V7.8"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      <path
        d="M16.2 6H19.8"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </IconBase>
  );
}

/* =========================================================
   Editează produs
========================================================= */

export function VendorEditIcon(
  props
) {
  return (
    <IconBase {...props}>
      <path
        d="M5 19H8.5L18.4 9.1C19.2 8.3 19.2 7 18.4 6.2L17.8 5.6C17 4.8 15.7 4.8 14.9 5.6L5 15.5V19Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      <path
        d="M13.8 6.7L17.3 10.2"
        stroke="currentColor"
        strokeWidth="1.8"
      />

      <path
        d="M4 21H20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </IconBase>
  );
}

/* =========================================================
   Preț și stoc
========================================================= */

export function VendorPriceIcon(
  props
) {
  return (
    <IconBase {...props}>
      <path
        d="M4 7.5L12 3L20 7.5V16.5L12 21L4 16.5V7.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      <path
        d="M4.5 7.7L12 12L19.5 7.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      <circle
        cx="17.5"
        cy="6.5"
        r="4.2"
        fill="currentColor"
      />

      <path
        d="M18.7 4.8C18.3 4.5 17.8 4.4 17.3 4.4C16.4 4.4 15.8 4.9 15.8 5.5C15.8 6.2 16.4 6.5 17.5 6.8C18.6 7.1 19.2 7.5 19.2 8.2C19.2 9 18.5 9.5 17.5 9.5C16.8 9.5 16.2 9.3 15.7 8.9"
        stroke="white"
        strokeWidth="1.2"
        strokeLinecap="round"
      />

      <path
        d="M17.5 3.8V10.1"
        stroke="white"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </IconBase>
  );
}

/* =========================================================
   Magazin
========================================================= */

export function VendorStoreIcon(
  props
) {
  return (
    <IconBase {...props}>
      <path
        d="M5 9V20H19V9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      <path
        d="M4 4H20L19 9C18.9 10.1 18 11 16.9 11C15.8 11 14.9 10.2 14.7 9.1C14.5 10.2 13.6 11 12.5 11C11.4 11 10.5 10.2 10.3 9.1C10.1 10.2 9.2 11 8.1 11C7 11 6.1 10.1 6 9L4 4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      <path
        d="M9 20V14H15V20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}