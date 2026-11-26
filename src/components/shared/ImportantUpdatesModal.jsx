// src/components/shared/ImportantUpdatesModal.jsx
// Super Admin's org-wide "Important Updates" broadcast (see
// send-announcement, org_announcements/org_announcement_acks) — a
// full-screen, un-dismissable popup shown to every active user who
// hasn't acknowledged the latest announcement yet. Mounted once at the
// app root (see App.jsx, inside AuthProvider) so it's present on every
// authenticated route without wiring into each page individually —
// deliberately separate from the normal notification bell/panel.
//
// Only the single latest org_announcements row ever matters: sending a
// new one simply supersedes whatever was there before, so this always
// checks against "the latest row", never a history.
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import Button from "../ui/Button";
import "../../styles/ImportantUpdatesModal.css";

export default function ImportantUpdatesModal() {
  const { profile } = useAuth();
  const [announcement, setAnnouncement] = useState(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [acking, setAcking] = useState(false);
  const bodyRef = useRef(null);

  async function checkForUnacknowledged() {
    const { data: latest } = await supabase
      .from("org_announcements")
      .select("id, items, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) {
      setAnnouncement(null);
      return;
    }
    // Must filter by user_id too, not just announcement_id — Super
    // Admin's own select policy on this table can see every user's ack
    // rows (so the compose page can show a count), not just their own.
    // Without this, once more than one person has acknowledged the same
    // announcement, .maybeSingle() sees multiple rows and throws — which,
    // with only `data` read here, silently came back as "nobody
    // acknowledged" and reshowed the popup every refresh, even to someone
    // who already had.
    if (!profile?.id) return;
    const { data: ack } = await supabase
      .from("org_announcement_acks")
      .select("id")
      .eq("announcement_id", latest.id)
      .eq("user_id", profile.id)
      .maybeSingle();
    setAnnouncement(ack ? null : latest);
  }

  useEffect(() => {
    if (!profile?.id) {
      setAnnouncement(null);
      return undefined;
    }
    checkForUnacknowledged();

    // Returning to an already-open tab — covers the case where Super
    // Admin sent this while the user was away, not just mid-session.
    function onVisibilityChange() {
      if (document.visibilityState === "visible") checkForUnacknowledged();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    // A tab already open and in the foreground when Super Admin sends a
    // new one gets it immediately, without waiting for a refocus.
    const channel = supabase
      .channel("org-announcements")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "org_announcements" }, () => checkForUnacknowledged())
      .subscribe();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  useEffect(() => {
    setScrolledToBottom(false);
    // Short enough to show without scrolling at all (no overflow) — there's
    // nothing to scroll to, so don't leave Acknowledge permanently disabled
    // waiting for a scroll event that can never fire. Checked after the
    // list has actually rendered (and once more after fonts/layout settle).
    const el = bodyRef.current;
    if (el && el.scrollHeight <= el.clientHeight) setScrolledToBottom(true);
    const raf = requestAnimationFrame(() => {
      const el2 = bodyRef.current;
      if (el2 && el2.scrollHeight <= el2.clientHeight) setScrolledToBottom(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [announcement?.id]);

  function onBodyScroll() {
    const el = bodyRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) setScrolledToBottom(true);
  }

  async function acknowledge() {
    if (!announcement) return;
    setAcking(true);
    try {
      const { error } = await supabase
        .from("org_announcement_acks")
        .insert({ announcement_id: announcement.id, user_id: profile.id });
      // A duplicate (already acked, e.g. a race between two open tabs) is
      // fine — either way the user has acknowledged it, so just close.
      if (error && error.code !== "23505") throw error;
      setAnnouncement(null);
    } catch {
      // Best-effort — if this genuinely fails, the popup simply reappears
      // next check and they try again; nothing destructive either way.
    } finally {
      setAcking(false);
    }
  }

  if (!announcement) return null;

  return (
    <div className="iu-overlay" role="dialog" aria-modal="true" aria-label="Important updates">
      <div className="iu-dialog">
        <h1 className="iu-title">Important Updates</h1>
        <div className="iu-body" ref={bodyRef} onScroll={onBodyScroll}>
          <ul className="iu-list">
            {announcement.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="iu-footer">
          {!scrolledToBottom && <p className="iu-hint">Scroll to the end to continue.</p>}
          <Button variant="primary" size="lg" disabled={!scrolledToBottom || acking} loading={acking} onClick={acknowledge}>
            I Acknowledge
          </Button>
        </div>
      </div>
    </div>
  );
}
