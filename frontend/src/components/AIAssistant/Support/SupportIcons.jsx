import React from "react";

const iconProps = {
  width: 21,
  height: 21,
  viewBox: "0 0 24 24",
  fill: "none",
  "aria-hidden": true,
};

export function SupportIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M4 13a8 8 0 0 1 16 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      <path
        d="M4 13v4a2 2 0 0 0 2 2h2v-7H6a2 2 0 0 0-2 1Zm16 0v4a2 2 0 0 1-2 2h-2v-7h2a2 2 0 0 1 2 1Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      <path
        d="M16 19c0 1.1-.9 2-2 2h-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TicketIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4V6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      <path
        d="M12 8v8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeDasharray="2 2"
      />
    </svg>
  );
}

export function ConversationIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M4 5h16v11H9l-5 4V5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      <path
        d="M8 9h8M8 13h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function FaqIcon() {
  return (
    <svg {...iconProps}>
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="1.8"
      />

      <path
        d="M9.8 9.2a2.5 2.5 0 1 1 4.2 1.9c-1.2.9-2 1.4-2 2.9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  );
}

export function HumanAgentIcon() {
  return (
    <svg {...iconProps}>
      <circle
        cx="12"
        cy="8"
        r="3"
        stroke="currentColor"
        strokeWidth="1.8"
      />

      <path
        d="M6 19c.5-3.4 2.5-5 6-5s5.5 1.6 6 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      <path
        d="M5 10.5v3M19 10.5v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SearchHelpIcon() {
  return (
    <svg {...iconProps}>
      <circle
        cx="10.5"
        cy="10.5"
        r="5.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />

      <path
        d="m15 15 4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      <path
        d="M9 9a1.8 1.8 0 1 1 3 1.3c-.8.6-1.3 1-1.3 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ReloadIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M19 7v5h-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M18 12a6.5 6.5 0 1 0-1.8 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}