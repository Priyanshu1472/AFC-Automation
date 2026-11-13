import { supabase } from "./supabase";

// Profile photos live in the public "user-avatars" bucket under the
// owner's own folder (see the 20261008000000_user_avatars migration).
const BUCKET = "user-avatars";
export const MAX_AVATAR_UPLOAD_BYTES = 10 * 1024 * 1024;

export function avatarUrl(path) {
  if (!path) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// `blob` is the already-cropped JPEG from AvatarCropModal. A fresh file
// name per upload, so browsers and the CDN never show a
// cached old photo; the previous file is removed once the new one is set.
export async function uploadOwnAvatar(userId, blob, previousPath) {
  const path = `${userId}/${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
  if (uploadError) throw uploadError;

  const { error: rpcError } = await supabase.rpc("set_own_avatar", { new_path: path });
  if (rpcError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw rpcError;
  }
  if (previousPath) await supabase.storage.from(BUCKET).remove([previousPath]);
}

export async function removeOwnAvatar(previousPath) {
  const { error } = await supabase.rpc("set_own_avatar", { new_path: null });
  if (error) throw error;
  if (previousPath) await supabase.storage.from(BUCKET).remove([previousPath]);
}
