-- Run this in the Supabase SQL Editor.
-- Atomically gives a user back one boost (used when the admin deletes a
-- match the user had spent a triple/boost on).
create or replace function refund_boost(uid uuid)
returns void
language sql
as $$
  update profiles set boosts_remaining = boosts_remaining + 1 where id = uid;
$$;
