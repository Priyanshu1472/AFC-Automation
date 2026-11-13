import { useState } from "react";
import { avatarUrl } from "../../lib/avatar";

// The user's profile photo, or their initial when they haven't set one
// (or the image fails to load). Sizing/shape come from `className`.
export default function ProfileAvatar({ profile, className = "" }) {
  const [failedPath, setFailedPath] = useState(null);
  const path = profile?.avatar_path;
  const initial = (profile?.full_name || "?").trim().charAt(0).toUpperCase();
  const showPhoto = path && failedPath !== path;

  return (
    <span className={`${className} profile-avatar`.trim()} aria-hidden="true">
      {showPhoto ? <img src={avatarUrl(path)} alt="" onError={() => setFailedPath(path)} /> : initial}
    </span>
  );
}
