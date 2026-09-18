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
      script.onerror = () => reject(new Error("Failed to load the verification widget."));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export default function Turnstile({ onVerify, onExpire }) {
  const containerRef = useRef(null);
  const widgetId = useRef(null);
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  const [error, setError] = useState("");

  useEffect(() => { onVerifyRef.current = onVerify; }, [onVerify]);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  useEffect(() => {
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || widgetId.current !== null) return;
        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onVerifyRef.current?.(token),
          "expired-callback": () => onExpireRef.current?.(),
          "error-callback": () => setError("Verification failed to load. Please refresh and try again."),
        });
      })
      .catch(() => setError("Couldn't load the verification widget. Check your connection and reload the page."));
    return () => {
      cancelled = true;
      if (widgetId.current !== null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
      }
    };
    // Intentionally empty deps — this must render exactly once per mount;
    // the parent forces a fresh mount (and thus a fresh widget) via `key`
    // whenever a new challenge is needed, rather than this effect re-running.
  }, []);

  if (!SITE_KEY) {
    return <p className="field-error">Verification is not configured (missing site key).</p>;
  }
  if (error) return <p className="field-error">{error}</p>;
  return <div ref={containerRef} />;
}
