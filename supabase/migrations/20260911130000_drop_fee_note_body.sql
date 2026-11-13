-- The free-text override for page 1 (added in 20260911120000) turned out to
-- be the wrong shape for how Person Responsible actually wants to work — a
-- separate box that could silently drift from the structured fee fields,
-- with a "Regenerate" action that discarded whatever was typed there.
-- Replaced with a live, read-only preview on the edit page instead —
-- composed straight from the structured fields as you type, never stored.
-- Nothing wrote to this column outside this session's own testing, so
-- there's no data to carry forward.
alter table public.fee_notes drop column note_body;
