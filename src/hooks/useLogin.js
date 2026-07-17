import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { VALID_ROLES } from "../lib/roles";
import {
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
  getRemainingAttempts,
} from "../lib/rateLimit";
import { useAuth } from "./useAuth";

function isValidEmail(val) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
}

export function useLogin() {
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(() => 5 - getRemainingAttempts("afc"));

  const handleLogin = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");

      const trimmedEmail = email.trim().toLowerCase();
      if (!trimmedEmail) return setError("Please enter your email address.");
      if (!isValidEmail(trimmedEmail)) return setError("Please enter a valid email address.");
      if (!password) return setError("Please enter your password.");

      const rateCheck = checkRateLimit("afc");
      if (!rateCheck.allowed) {
        setError(
          `Too many failed attempts. Please wait ${rateCheck.waitMinutes} minute${rateCheck.waitMinutes > 1 ? "s" : ""} before trying again.`
        );
        return;
      }

      setLoading(true);
      try {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });

        if (authError) {
          const count = recordFailedAttempt("afc");
          setAttempts(count);
          const remaining = 5 - count;
          setError(
            remaining > 0
              ? `Invalid email or password. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`
              : "Too many failed attempts. Please wait 15 minutes before trying again."
          );
          return;
        }

        // Pull the fresh afc_users row synchronously so we can gate on
        // is_active / role / must_change_password before navigating.
        const sessionUser = await refreshProfile();
        const { data: profile, error: profileError } = await supabase
          .from("afc_users")
          .select("role, is_active, must_change_password")
          .eq("id", sessionUser.id)
          .maybeSingle();

        if (profileError || !profile) {
          await supabase.auth.signOut();
          setError("Account not found in the system. Please contact your administrator.");
          return;
        }
        if (!profile.is_active) {
          await supabase.auth.signOut();
          setError("Your account has been deactivated. Please contact your administrator.");
          return;
        }
        if (!VALID_ROLES.has(profile.role)) {
          await supabase.auth.signOut();
          setError("Your account has an invalid role. Please contact your administrator.");
          return;
        }

        clearRateLimit("afc");
        setAttempts(0);
        navigate(profile.must_change_password ? "/change-password" : "/home", { replace: true });
      } catch {
        setError("Something went wrong. Please check your connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    [email, password, navigate, refreshProfile]
  );

  return {
    email,
    setEmail,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    error,
    loading,
    attempts,
    handleLogin,
  };
}
