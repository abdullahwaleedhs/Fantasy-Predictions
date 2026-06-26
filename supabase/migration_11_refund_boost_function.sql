-- Run this in the Supabase SQL Editor.
-- Atomically gives a user back one boost (used when the admin deletes a
-- match the user had spent a triple/boost on). security definer is required
-- because the "Users can update their own profile" RLS policy would
-- otherwise block the admin's session from touching another user's row.
create or replace function refund_boost(uid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update profiles set boosts_remaining = boosts_remaining + 1 where id = uid;
$$;

grant execute on function public.refund_boost(uuid) to anon, authenticated;
