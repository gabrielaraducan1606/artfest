// backend/src/couriers/errors.js

/*
 * Erori comune pentru integrarea cu curierii. Mesajele sunt FIXE și
 * sigure pentru UI/loguri - nu includ niciodată răspunsul brut al
 * curierului, credentiale, token-uri sau headere.
 */

export class CourierError extends Error {
  constructor(code, message, { httpStatus = 500, retryable = false } = {}) {
    super(message);
    this.name = "CourierError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

// credentialele au fost respinse de curier (401/403 la autentificare)
export class CourierAuthError extends CourierError {
  constructor(message = "Curierul a respins datele de autentificare.") {
    super("courier_auth_failed", message, { httpStatus: 422 });
    this.name = "CourierAuthError";
  }
}

// API-ul curierului nu răspunde / răspunde cu 5xx / răspuns neașteptat
export class CourierUnavailableError extends CourierError {
  constructor(message = "Serviciul curierului nu este disponibil momentan. Încearcă mai târziu.") {
    super("courier_unavailable", message, { httpStatus: 502, retryable: true });
    this.name = "CourierUnavailableError";
  }
}

export class CourierTimeoutError extends CourierError {
  constructor(message = "Serviciul curierului nu a răspuns la timp. Încearcă mai târziu.") {
    super("courier_timeout", message, { httpStatus: 504, retryable: true });
    this.name = "CourierTimeoutError";
  }
}

// input invalid (câmpuri lipsă / format greșit) - detectat înainte de apel
export class CourierValidationError extends CourierError {
  constructor(message = "Datele trimise nu sunt valide.", fields = []) {
    super("courier_validation_failed", message, { httpStatus: 400 });
    this.name = "CourierValidationError";
    this.fields = fields;
  }
}

export class CourierProviderNotSupportedError extends CourierError {
  constructor() {
    super("courier_provider_not_supported", "Acest curier nu este disponibil încă.", {
      httpStatus: 400,
    });
    this.name = "CourierProviderNotSupportedError";
  }
}

// configurare server lipsă/greșită (ex. cheia de criptare) - nu salvăm nimic
export class CourierConfigError extends CourierError {
  constructor(message = "Conectarea curierilor nu este disponibilă momentan.") {
    super("courier_encryption_unavailable", message, { httpStatus: 503 });
    this.name = "CourierConfigError";
  }
}

// credentialele salvate nu mai pot fi decriptate (cheie lipsă / date corupte)
export class CourierCredentialsUnreadableError extends CourierError {
  constructor() {
    super(
      "courier_credentials_unreadable",
      "Datele de conectare salvate nu mai pot fi folosite. Reintrodu credentialele contului.",
      { httpStatus: 409 }
    );
    this.name = "CourierCredentialsUnreadableError";
  }
}

export function isCourierError(e) {
  return e instanceof CourierError;
}
