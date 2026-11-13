-- Storage's remove() first looks the object up under the caller's own
-- permissions, so without a SELECT policy it matched nothing and silently
-- deleted nothing — replaced/removed profile photos were left behind.
-- (Public reads of the image go through the public URL and don't need
-- this; it only lets a user see their own folder for remove/replace.)

drop policy if exists "user_avatars_select_own" on storage.objects;
create policy "user_avatars_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
