import { Navigate } from "react-router-dom";
import PageLoader from "../ui/PageLoader";
import { useAuth } from "../../hooks/useAuth";

// Wraps /login, /forgot-password — bounces an already-authenticated user
// away instead of letting them see a login form for an account they're
// already signed into.
export default function PublicOnlyRoute({ children }) {
  const { user, profile, loading } = useAuth();

  if (loading) return <PageLoader />;

  // Only redirect an active account — an inactive one is left on the
  // login form so useLogin's own validation can sign it back out and
  // show the "deactivated" error, instead of flashing /home first.
  if (user && profile?.is_active) {
    return <Navigate to={profile.must_change_password ? "/change-password" : "/home"} replace />;
  }

  return children;
}
