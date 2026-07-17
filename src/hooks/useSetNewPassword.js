import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

const MIN_LENGTH = 12;
const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

export function useSetNewPassword() {
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");

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
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) {
          setError(updateError.message || "Could not update password. Please try again.");
          return;
        }

        const { error: rpcError } = await supabase.rpc("mark_password_changed");
        if (rpcError) {
          setError("Password was updated, but we couldn't finish setup. Please contact your administrator.");
          return;
        }

        await refreshProfile();
        navigate("/home", { replace: true });
      } catch {
        setError("Something went wrong. Please check your connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    [password, confirmPassword, navigate, refreshProfile]
  );

  return {
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    loading,
    submit,
  };
}
