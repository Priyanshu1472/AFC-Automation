import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

const MIN_LENGTH = 8;
const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

// requireMarkChanged: call mark_password_changed() after updating — only
// relevant for the forced first-login flow (ChangePasswordPage). A
// voluntary change from My Profile leaves must_change_password untouched
// (it's already false).
// redirectTo: where to send the user after a successful change; pass null
// to stay on the current page and show `success` instead (My Profile).
// requireCurrentPassword: My Profile only — the user already has a live
// session, so nothing else proves the person at the keyboard is the account
// owner. Verified by re-authenticating with signInWithPassword before the
// update. Not used by ResetPasswordPage (recovery link) or ChangePasswordPage
// (forced first login) — in both, the "current" password isn't something
// the user should be assumed to still know/want to re-enter.
export function useSetNewPassword({ requireMarkChanged = true, redirectTo = "/home", requireCurrentPassword = false } = {}) {
  const navigate = useNavigate();
  const { profile, refreshProfile } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");
      setSuccess(false);

      if (requireCurrentPassword && !currentPassword) {
        return setError("Please enter your current password.");
      }
      if (password.length < MIN_LENGTH) {
        return setError(`Password must be at least ${MIN_LENGTH} characters long.`);
      }
      if (!STRONG_PASSWORD.test(password)) {
        return setError(
          "Password must include an uppercase letter, a lowercase letter, a digit, and a symbol."
        );
      }
      if (password !== confirmPassword) {
        return setError("Passwords do not match.");
      }

      setLoading(true);
      try {
        if (requireCurrentPassword) {
          const { error: verifyError } = await supabase.auth.signInWithPassword({
            email: profile.email,
            password: currentPassword,
          });
          if (verifyError) {
            setError("Current password is incorrect.");
            return;
          }
        }

        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) {
          setError(updateError.message || "Could not update password. Please try again.");
          return;
        }

        if (requireMarkChanged) {
          const { error: rpcError } = await supabase.rpc("mark_password_changed");
          if (rpcError) {
            setError("Password was updated, but we couldn't finish setup. Please contact your administrator.");
            return;
          }
        }

        await refreshProfile();
        setCurrentPassword("");
        setPassword("");
        setConfirmPassword("");
        if (redirectTo) {
          navigate(redirectTo, { replace: true });
        } else {
          setSuccess(true);
        }
      } catch {
        setError("Something went wrong. Please check your connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    [currentPassword, password, confirmPassword, navigate, refreshProfile, requireMarkChanged, redirectTo, requireCurrentPassword, profile?.email]
  );

  return {
    currentPassword,
    setCurrentPassword,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    loading,
    success,
    submit,
  };
}
