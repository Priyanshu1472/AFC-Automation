// Cloudflare Turnstile widget, rendered explicitly (not via the implicit
// data-attribute API, which doesn't play well with React re-renders).
// Loaded via a runtime script tag rather than a bundled dependency — same
// spirit as the dynamic-import pattern used elsewhere in this codebase for
// big one-off external resources (e.g. src/lib/embeddingModel.js), just for
// a plain <script> instead of an ES module. Cached at module scope so the
// script is fetched once regardless of how many times this component mounts
// (e.g. React StrictMode's double-invoke in development).
//
// The verified token is consumed by Supabase Auth itself
// (supabase.auth.signInWithPassword({ options: { captchaToken } })) — this
// component only renders the widget and hands back the token; it never
// talks to Cloudflare's verify endpoint directly (that happens server-side,
// inside Supabase Auth, using the secret key configured in the Supabase
// dashboard — never in this codebase).
import { useEffect, useRef, useState } from "react";

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise = null;
function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        // Clear the cache on failure — otherwise this stays a permanently
        // rejected promise for the rest of the tab's life, and every later
        // mount (e.g. landing back on /login after signing out, which is a
        // client-side route change, not a page reload) reuses it and fails
        // instantly without ever re-attempting the actual network request.
        document.head.removeChild(script);
        scriptPromise = null;
        reject(new Error("Failed to load the verification widget."));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

// How long to wait before offering a manual retry — Cloudflare's script is
// usually near-instant, but a slow/filtered network can leave the widget
// stuck with no feedback at all, which looks indistinguishable from broken.
const SLOW_LOAD_MS = 8000;

export default function Turnstile({ onVerify, onExpire }) {
  const containerRef = useRef(null);
  const widgetId = useRef(null);
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  const [error, setError] = useState("");
  const [slow, setSlow] = useState(false);
  // Bumped by the "Try again" button to re-run the load effect below —
  // separate from the parent's captchaResetKey remount, which is for
  // starting a fresh challenge after a submit, not for retrying a load
  // that never got off the ground.
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => { onVerifyRef.current = onVerify; }, [onVerify]);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  useEffect(() => {
    let cancelled = false;
    setSlow(false);
    const slowTimer = setTimeout(() => { if (!cancelled) setSlow(true); }, SLOW_LOAD_MS);
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || widgetId.current !== null) return;
        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onVerifyRef.current?.(token),
          "expired-callback": () => onExpireRef.current?.(),
          "error-callback": () => setError("Verification failed to load."),
        });
      })
      .catch(() => setError("Couldn't load the verification widget."))
      .finally(() => clearTimeout(slowTimer));
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
      if (widgetId.current !== null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
    // retryNonce is the one intentional exception to "render once per
    // mount" — it exists purely so the "Try again" button below can force
    // a fresh attempt without waiting on the parent's captchaResetKey
    // remount cycle (which only happens after a submit, not on a stuck load).
  }, [retryNonce]);

  function retry() {
    setError("");
    setSlow(false);
    setRetryNonce((n) => n + 1);
  }

  if (!SITE_KEY) {
    return <p className="field-error">Verification is not configured (missing site key).</p>;
  }
  return (
    <>
      <div ref={containerRef} />
      {!error && slow && (
        <p className="field-hint">
          Still loading verification — this can take a moment on a slow connection.{" "}
          <button type="button" className="afc-link-btn" onClick={retry}>Try again</button>
        </p>
      )}
      {error && (
        <p className="field-error">
          {error}{" "}
          <button type="button" className="afc-link-btn" onClick={retry}>Try again</button>
        </p>
      )}
    </>
  );
}
