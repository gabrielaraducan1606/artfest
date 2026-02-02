// frontend/src/pages/Vendor/Orders/utils/constants.js

export const STATUS_OPTIONS = [
  { value: "", label: "Toate" },
  { value: "new", label: "Nouă" },
  { value: "preparing", label: "În pregătire" },
  { value: "confirmed", label: "Confirmată (gata de predare)" },
  { value: "fulfilled", label: "Finalizată" },
  { value: "cancelled", label: "Anulată" },
];

export const CANCEL_REASONS = [
  { value: "client_no_answer", label: "Clientul nu răspunde la telefon" },
  { value: "client_request", label: "Clientul a solicitat anularea" },
  { value: "stock_issue", label: "Produs indisponibil / stoc epuizat" },
  { value: "address_issue", label: "Adresă incompletă / imposibil de livrat" },
  { value: "payment_issue", label: "Probleme cu plata" },
  { value: "other", label: "Alt motiv" },
];
