// Client-side rate limiting for login attempts.
// Prevents casual brute-forcing of the login form.
//
// Note: this is CLIENT-SIDE only — a determined attacker can bypass it.
// It stops casual brute force, nothing more.

const LIMITS = {
  afc: { max: 5, windowMs: 15 * 60 * 1000 }, // 5 attempts per 15 min
};

function getKey(type) {
  return `rate_limit_${type}`;
}

function getAttempts(type) {
  try {
    const stored = localStorage.getItem(getKey(type));
    if (!stored) return { count: 0, firstAttempt: null };
    return JSON.parse(stored);
  } catch {
    return { count: 0, firstAttempt: null };
  }
}

function saveAttempts(type, data) {
  localStorage.setItem(getKey(type), JSON.stringify(data));
}

/**
 * { allowed: true } — OK to proceed
 * { allowed: false, waitMs, waitMinutes } — blocked
 */
export function checkRateLimit(type = "afc") {
  const limit = LIMITS[type];
  const attempts = getAttempts(type);
  const now = Date.now();

  if (attempts.firstAttempt && now - attempts.firstAttempt > limit.windowMs) {
    saveAttempts(type, { count: 0, firstAttempt: null });
    return { allowed: true };
  }

  if (attempts.count >= limit.max) {
    const waitMs = limit.windowMs - (now - attempts.firstAttempt);
    return { allowed: false, waitMs, waitMinutes: Math.ceil(waitMs / 60000) };
  }

  return { allowed: true };
}

export function recordFailedAttempt(type = "afc") {
  const attempts = getAttempts(type);
  const now = Date.now();
  const updated = {
    count: attempts.count + 1,
    firstAttempt: attempts.firstAttempt || now,
  };
  saveAttempts(type, updated);
  return updated.count;
}

export function clearRateLimit(type = "afc") {
  localStorage.removeItem(getKey(type));
}

export function getRemainingAttempts(type = "afc") {
  const limit = LIMITS[type];
  const attempts = getAttempts(type);
  return Math.max(0, limit.max - attempts.count);
}
