// supabase/functions/_shared/serviceAuth.ts
// Verifies the short-lived HS256 service token Experience Intelligence signs
// for machine-to-machine calls (see that repo's app/core/security.py::
// create_service_token). This is deliberately NOT a Supabase user JWT — it
// carries no afc_users identity, only a client_id — so it does not go
// through _shared/auth.ts::getCallerProfile, and the function it protects
// must be registered with `verify_jwt = false` in config.toml (Supabase's
// gateway would otherwise reject it as an invalid Supabase-signed token
// before our own code ever runs).

async function hmacSha256(secret: string, data: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type ServiceTokenResult =
  | { ok: true; clientId: string }
  | { ok: false; status: number; error: string };

// `expectedAudience` must match the `aud` claim Experience Intelligence
// signs (audience="experience-import-gateway"), so a token minted for one
// integration can't be replayed against a different one.
export async function verifyServiceToken(
  req: Request,
  secret: string,
  expectedAudience: string,
  expectedClientId: string
): Promise<ServiceTokenResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing bearer token." };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, status: 401, error: "Malformed service token." };
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string };
  let payload: { sub?: string; aud?: string; exp?: number; iat?: number };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)));
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
  } catch {
    return { ok: false, status: 401, error: "Malformed service token." };
  }

  if (header.alg !== "HS256") {
    return { ok: false, status: 401, error: "Unsupported token algorithm." };
  }

  const expectedSig = bytesToBase64Url(await hmacSha256(secret, `${headerB64}.${payloadB64}`));
  // Constant-time-ish comparison — lengths already validated equal by
  // base64url encoding of a fixed-size HMAC, so a simple loop is fine here.
  if (expectedSig.length !== sigB64.length) {
    return { ok: false, status: 401, error: "Invalid service token signature." };
  }
  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) diff |= expectedSig.charCodeAt(i) ^ sigB64.charCodeAt(i);
  if (diff !== 0) {
    return { ok: false, status: 401, error: "Invalid service token signature." };
  }

  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
    return { ok: false, status: 401, error: "Service token expired." };
  }
  if (payload.aud !== expectedAudience) {
    return { ok: false, status: 401, error: "Service token audience mismatch." };
  }
  if (payload.sub !== expectedClientId) {
    return { ok: false, status: 403, error: "Unknown client id." };
  }
  const headerClientId = req.headers.get("x-client-id");
  if (headerClientId && headerClientId !== expectedClientId) {
    return { ok: false, status: 403, error: "Client id header mismatch." };
  }

  return { ok: true, clientId: payload.sub };
}
