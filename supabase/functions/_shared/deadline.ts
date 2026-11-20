// supabase/functions/_shared/deadline.ts
// leads.submission_deadline is a plain DATE ("2026-11-20"). `new Date(d)`
// reads that as midnight UTC = 5:30 AM IST, so the old `new Date(d) <
// new Date()` checks locked a lead at 5:30 AM on its own last day. The
// last date is a whole working day in India: it stays open until
// 11:59:59 PM IST on that date and only counts as passed after that.
// Mirrored in src/lib/deadline.js for the frontend; keep both in sync.

export function deadlineEnd(deadline: string | Date): Date {
  const s = typeof deadline === "string" ? deadline : deadline.toISOString();
  const day = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Date(`${day}T23:59:59.999+05:30`);
  return new Date(deadline);
}

export function isDeadlinePassed(deadline: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!deadline) return false;
  return deadlineEnd(deadline).getTime() < now.getTime();
}
