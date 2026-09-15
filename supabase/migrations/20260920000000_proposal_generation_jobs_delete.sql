-- Lets whoever can edit the proposal remove a past "Generate Final
-- Proposal" run from its history — same permission gate as every other
-- write on this proposal (can_edit_proposal: role + not locked). Safe to
-- delete a still-queued/processing row too: the worker's eventual
-- status update just affects 0 rows if the job is already gone, no error.
create policy proposal_generation_jobs_delete on public.proposal_generation_jobs
for delete using (public.can_edit_proposal(proposal_id));
