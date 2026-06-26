-- Run this in the Supabase SQL Editor.
alter table matches add column if not exists venue_team text;
