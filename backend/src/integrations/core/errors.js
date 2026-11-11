// backend/src/integrations/core/errors.js
//
// Erorile motorului de integrări. `retryable` decide dacă un job din coadă
// se reîncearcă (rețea, 429, 5xx) sau se oprește (credentiale greșite,
// date invalide). Mesajele sunt pentru vânzător; detaliile tehnice rămân
// în `details` (fără secrete).

export class IntegrationError extends Error {
  constructor(code, message, { status = 400, retryable = false, details = null } = {}) {
    super(message || code);
    this.name = "IntegrationError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export function isRetryable(error) {
  return Boolean(error?.retryable);
}

export class IntegrationConfigError extends IntegrationError {
  constructor() {
    super(
      "integration_encryption_unavailable",
      "Conectarea magazinelor externe nu este configurată pe server.",
      { status: 503 }
    );
    this.name = "IntegrationConfigError";
  }
}

export class IntegrationCredentialsUnreadableError extends IntegrationError {
  constructor() {
    super(
      "integration_credentials_unreadable",
      "Datele de conectare ale magazinului nu mai pot fi citite. Reconectează magazinul.",
      { status: 409 }
    );
    this.name = "IntegrationCredentialsUnreadableError";
  }
}
