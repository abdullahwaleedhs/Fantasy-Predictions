-- Run this in the Supabase SQL Editor.
-- Tracks when a user last changed their username, so we can only let
-- them change it once every 6 months.
alter table profiles add column if not exists username_changed_at timestamptz;
