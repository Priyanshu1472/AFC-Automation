-- is_lead_chat_participant() has always been callable directly (Postgres
-- grants EXECUTE to PUBLIC by default on a new function unless revoked,
-- and this one was never explicitly revoked like its sibling RPCs are) —
-- but nothing in the frontend relied on that until now. LeadChatPanel
-- needs to know, before it renders anything, whether the viewer is
-- actually on a given lead's chat roster, so the floating chat bubble
-- itself can stay hidden for a DGM/AGM/GM/SRM who can see the lead (e.g.
-- org-wide) but hasn't been added to its chat via PMT's "Add to Chat" on
-- a cross-team query. Declared explicitly here, matching the
-- revoke-then-grant convention every other narrow RPC in this app follows,
-- rather than continuing to depend on the implicit default.
revoke all on function public.is_lead_chat_participant(uuid) from public;
grant execute on function public.is_lead_chat_participant(uuid) to authenticated;
