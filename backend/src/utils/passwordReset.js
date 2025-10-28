import crypto from "crypto";

export function generateRawToken() {
  return crypto.randomBytes(32).toString("hex"); // 64 hex chars
}

export function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}
