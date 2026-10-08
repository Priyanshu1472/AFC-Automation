-- Profile photos — each user uploads their own from My Profile; shown in
-- the nav's profile avatar instead of their initial.
--
-- Unlike user-signatures (private, service-role edge functions only), a
-- profile photo is meant to be seen, so the bucket is public-read and the
-- client uploads directly. Writes are limited to the caller's own folder
-- ("<auth.uid()>/<file>") by the storage policies below, and the path is
-- recorded on afc_users only via set_own_avatar(), which re-checks it.

alter table public.afc_users add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-avatars', 'user-avatars', true, 1048576,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "user_avatars_insert_own" on storage.objects;
create policy "user_avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "user_avatars_update_own" on storage.objects;
create policy "user_avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "user_avatars_delete_own" on storage.objects;
create policy "user_avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- new_path null removes the photo. Otherwise it must sit in the caller's
-- own folder, so nobody can point their profile at someone else's file.
create or replace function public.set_own_avatar(new_path text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if new_path is not null and split_part(new_path, '/', 1) <> auth.uid()::text then
    raise exception 'Invalid photo path.';
  end if;

  update public.afc_users
  set avatar_path = new_path, updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.set_own_avatar(text) from public;
grant execute on function public.set_own_avatar(text) to authenticated;
