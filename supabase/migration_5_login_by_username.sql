-- Run this in the Supabase SQL Editor.
-- Lets users log in with their username instead of their email, without
-- exposing the profiles table's emails to everyone (it isn't stored there).
-- This function only returns the single matching email for an exact
-- username, not a bulk listing.
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
  where p.username = p_username;
  return result;
end;
$$;

grant execute on function public.get_email_for_username(text) to anon, authenticated;
