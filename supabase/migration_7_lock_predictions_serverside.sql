-- Closes the "change your phone's clock to unlock predictions" loophole.
-- Previously, locking matches once they start was only enforced in the
-- React app using the device's own clock, so a user could change their
-- phone's date/time to fool the countdown and submit/edit predictions for
-- a match that has already kicked off. This migration enforces the lock
-- using the database server's clock (now()) instead, which the client
-- cannot tamper with, no matter what the app sends.
--
-- Paste this whole file into the Supabase SQL Editor and click "Run".

drop policy if exists "Users can insert their own predictions" on predictions;
drop policy if exists "Users can update their own predictions" on predictions;

-- Match times are entered/displayed in Saudi local time (Asia/Riyadh), so we
-- compare against the server clock converted to that same time zone.
create policy "Users can insert their own predictions"
  on predictions for insert
  with check (
    auth.uid() = user_id
    and not exists (
      select 1 from matches m
      where m.id = match_id
        and m.match_date is not null
        and m.match_time is not null
        and (m.match_date + m.match_time) <= (now() at time zone 'Asia/Riyadh')
    )
  );

create policy "Users can update their own predictions"
  on predictions for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and not exists (
      select 1 from matches m
      where m.id = match_id
        and m.match_date is not null
        and m.match_time is not null
        and (m.match_date + m.match_time) <= (now() at time zone 'Asia/Riyadh')
    )
  );
