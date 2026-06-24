-- Run this in the Supabase SQL Editor.
-- Some accounts were created before usernames were normalized to lowercase
-- on registration, so they may still be stored with capital letters. Login
-- already lowercases what the user types, but the lookup below was doing
-- an exact (case-sensitive) match against the stored username - so those
-- older accounts could only log in by typing the exact original casing.
-- Switching to a case-insensitive comparison fixes that for every account,
-- old or new.
create or replace function public.get_email_for_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  result text;
begin
  select au.email into result
  from auth.users au
  join public.profiles p on p.id = au.id
  where lower(p.username) = lower(p_username);
  return result;
end;
$$;

grant execute on function public.get_email_for_username(text) to anon, authenticated;
