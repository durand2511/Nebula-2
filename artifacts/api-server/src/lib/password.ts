/**
 * Password hashing for booking-app accounts. Uses Node's built-in scrypt (no native deps, so it
 * bundles cleanly with esbuild). Format: "scrypt$<saltHex>$<hashHex>". Verification is constant-time.
 * Session tokens are 256-bit random hex.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw), salt, 64);
  return "scrypt$" + salt.toString("hex") + "$" + hash.toString("hex");
}

export function verifyPassword(pw: string, stored: string): boolean {
  try {
    const parts = String(stored || "").split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = scryptSync(String(pw), salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}
