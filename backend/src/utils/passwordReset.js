import crypto from "crypto";

export function generateRawToken() {
  // token random, URL-safe
  return crypto.randomBytes(32).toString("hex");
}

export function hashToken(raw) {
  // ca să nu stocăm tokenul în clar
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}
