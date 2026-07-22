import React from "react";

const DEFAULT_SIZE = 21;

function IconBase({
  children,
  size = DEFAULT_SIZE,
  className,
  ...props
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ShoppingBagIcon(props) {
  return (
    <IconBase {...props}>
      <path
        d="M5 8h14l1 13H4L5 8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9 9V6a3 3 0 0 1 6 0v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </IconBase>
  );
}

export function CameraIcon(props) {
  return (
    <IconBase {...props}>
      <path
        d="M4 7.5h3l1.4-2h7.2l1.4 2h3A2 2 0 0 1 22 9.5v8A2 2 0 0 1 20 19.5H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="13.5"
        r="3.5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M18.5 10h.01"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </IconBase>
  );
}

export function GiftIcon(props) {
  return (
    <IconBase {...props}>
      <path
        d="M4 10h16v10H4V10Zm-1-4h18v4H3V6Zm9 0v14"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M12 6H8.5A2.5 2.5 0 1 1 11 3.5L12 6Zm0 0h3.5A2.5 2.5 0 1 0 13 3.5L12 6Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

export function SearchIcon(props) {
  return (
    <IconBase {...props}>
      <circle
        cx="11"
        cy="11"
        r="6.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="m16 16 5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M8.5 11h5M11 8.5v5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        opacity=".65"
      />
    </IconBase>
  );
}

export function WalletIcon(props) {
  return (
    <IconBase {...props}>
      <path
        d="M3 6.5A2.5 2.5 0 0 1 5.5 4H19v16H5.5A2.5 2.5 0 0 1 3 17.5v-11Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M15 10h7v5h-7a2.5 2.5 0 0 1 0-5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle
        cx="16"
        cy="12.5"
        r=".75"
        fill="currentColor"
      />
    </IconBase>
  );
}