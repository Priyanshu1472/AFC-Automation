-- Self-service "My Profile": any signed-in user (staff or business_associate
-- portal account) can fix the spelling of their own name. Email/role/team/
-- office stay admin-managed — this RPC only ever touches full_name on the
-- caller's own row, same narrow-RPC pattern as mark_password_changed().
create or replace function public.update_own_full_name(new_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if new_name is null or length(trim(new_name)) < 2 then
    raise exception 'Full name must be at least 2 characters.';
  end if;
  if length(trim(new_name)) > 120 then
    raise exception 'Full name is too long.';
  end if;

  update public.afc_users
  set full_name = trim(new_name), updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.update_own_full_name(text) from public;
grant execute on function public.update_own_full_name(text) to authenticated;
