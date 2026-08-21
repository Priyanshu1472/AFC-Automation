// supabase/functions/_shared/pin.ts
// A reusable 4-digit action PIN (separate from the login password) that
// gates every committee/MD decision on a lead. One-way SHA-256 hash,
// salted with the user's own id — nobody, including Admin, can recover
// the actual digits, only reset them. The hash isn't really the security
// boundary here (4 digits = 10,000 possibilities, trivially brute-forced
// offline against a stolen hash) — rate-limited verification is, so
// verifyPin always checks that first. Every account gets the same default
// PIN ("1234") set at creation time (create-staff-user) and backfilled onto
// pre-existing accounts (see migration 20260824000000) — a user changes it
// from My Profile whenever they want, same as a default password.

import { createAdminClient } from "./auth.ts";
import { checkRateLimit } from "./publicAccess.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

export const DEFAULT_PIN = "1234";
const PIN_PATTERN = /^\d{4}$/;

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_PATTERN.test(pin);
}

export async function hashPin(pin: string, userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${pin}:${userId}`));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Rate-limited PIN check for gating a lead-workflow action. Takes the
// caller's own pin_hash (already fetched as part of getCallerProfile — no
// second query) rather than looking it up again. Returns an error string
// on failure (rate-limited, no PIN set, or wrong PIN), or null on success.
export async function verifyActionPin(admin: AdminClient, userId: string, pinHash: string | null, candidatePin: unknown): Promise<string | null> {
  const rate = await checkRateLimit(admin, `lead_action_pin:${userId}`, 5, 15 * 60);
  if (!rate.allowed) return `Too many incorrect PIN attempts. Try again in about ${rate.waitMinutes} minute(s).`;

  if (!isValidPin(candidatePin)) return "Enter your 4-digit PIN.";
  if (!pinHash) return "You haven't set an action PIN yet — set one from My Profile before you can do this.";

  const candidateHash = await hashPin(candidatePin, userId);
  if (candidateHash !== pinHash) return "Incorrect PIN.";

  return null;
}
