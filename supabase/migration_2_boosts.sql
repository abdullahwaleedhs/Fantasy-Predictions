-- Run this in the Supabase SQL Editor (you already ran schema.sql once,
-- this just adds the one new column it now includes).
alter table profiles add column if not exists boosts_remaining int not null default 3;
