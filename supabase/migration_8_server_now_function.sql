-- The previous fix tried to read the server's clock from the HTTP "Date"
-- response header, but browsers don't expose that header to cross-origin
-- fetch() calls by default, so it silently did nothing and the countdown
-- kept trusting the device's own clock - meaning changing the phone's
-- date/time still fooled the on-screen lock for the app's own user.
--
-- This adds a tiny RPC function the app can call to get the real server
-- time back in the response body (which IS readable), so the app can
-- compute an accurate offset and stop trusting the device's clock.
--
-- Paste this whole file into the Supabase SQL Editor and click "Run".

create or replace function public.server_now()
returns timestamptz
language sql
stable
as $$
  select now();
$$;

grant execute on function public.server_now() to anon, authenticated;
