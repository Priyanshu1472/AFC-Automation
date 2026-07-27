// supabase/functions/_shared/notify.ts
// Best-effort in-app notification helpers shared by every empanelment edge
// function. A failed insert here must never block the actual pipeline
// action, so every function here swallows its own errors and just logs.

import { createAdminClient } from "./auth.ts";
import { sendResendEmail } from "./email.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

export type NotifyPayload = {
  title: string;
  sub_text?: string | null;
  // "action_required" surfaces on the recipient's Home page pending-action
  // list; anything else (e.g. "info") is bell-only.
  type: string;
  link?: string | null;
};

export async function notifyUsers(admin: AdminClient, userIds: (string | null | undefined)[], payload: NotifyPayload) {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;
  try {
    await admin.from("notifications").insert(
      ids.map((user_id) => ({
        user_id,
        title: payload.title,
        sub_text: payload.sub_text || null,
        type: payload.type,
        link: payload.link || null,
      }))
    );
  } catch (err) {
    console.error("notifyUsers failed:", (err as Error).message);
  }
}

export async function notifyUser(admin: AdminClient, userId: string | null | undefined, payload: NotifyPayload) {
  await notifyUsers(admin, [userId], payload);
}

// Looks up active users by role (optionally scoped to a team) and notifies
// all of them — used for org-wide roles like cfo/cs/md where there's no
// single per-application assignee.
export async function notifyRole(admin: AdminClient, role: string, payload: NotifyPayload, team?: string | null) {
  let query = admin.from("afc_users").select("id").eq("role", role).eq("is_active", true);
  if (team) query = query.eq("team", team);
  const { data, error } = await query;
  if (error) {
    console.error("notifyRole lookup failed:", error.message);
    return;
  }
  await notifyUsers(admin, (data || []).map((u: { id: string }) => u.id), payload);
}

// Notifies every active member of a team — used for closure notices like
// "MD accepted this application" that go to the whole team, not one person.
export async function notifyTeam(admin: AdminClient, team: string, payload: NotifyPayload, excludeUserId?: string | null) {
  const { data, error } = await admin.from("afc_users").select("id").eq("team", team).eq("is_active", true);
  if (error) {
    console.error("notifyTeam lookup failed:", error.message);
    return;
  }
  const ids = (data || []).map((u: { id: string }) => u.id).filter((id: string) => id !== excludeUserId);
  await notifyUsers(admin, ids, payload);
}

// Actual email (not just the in-app bell) to one specific user by id — used
// for per-application assignees (the PO/DGM on this application) rather than
// a whole role. Best-effort, same as emailRole.
export async function emailUser(admin: AdminClient, userId: string | null | undefined, mail: { subject: string; html: string }) {
  if (!userId) return;
  const { data, error } = await admin.from("afc_users").select("email").eq("id", userId).maybeSingle();
  if (error || !data?.email) {
    console.error("emailUser lookup failed:", error?.message || "no email on file");
    return;
  }
  try {
    await sendResendEmail({ to: data.email, subject: mail.subject, html: mail.html });
  } catch (err) {
    console.error(`emailUser send to ${data.email} failed:`, (err as Error).message);
  }
}

// Actual email (not just the in-app bell) to every active user in a role —
// used where the in-app notification alone isn't enough (e.g. CFO/CS need
// to know an application is waiting even if they haven't opened the app).
// Best-effort per recipient: one failed send never blocks the others or the
// caller's real action.
export async function emailRole(
  admin: AdminClient,
  role: string,
  mail: { subject: string; html: string },
  team?: string | null
) {
  let query = admin.from("afc_users").select("email").eq("role", role).eq("is_active", true);
  if (team) query = query.eq("team", team);
  const { data, error } = await query;
  if (error) {
    console.error("emailRole lookup failed:", error.message);
    return;
  }
  await Promise.all(
    (data || [])
      .map((u: { email: string }) => u.email)
      .filter(Boolean)
      .map((to: string) => sendResendEmail({ to, subject: mail.subject, html: mail.html }).catch((err) => {
        console.error(`emailRole send to ${to} failed:`, (err as Error).message);
      }))
  );
}
