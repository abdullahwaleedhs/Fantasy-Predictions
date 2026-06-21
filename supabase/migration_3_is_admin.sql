-- Run this in the Supabase SQL Editor.
-- Adds an admin flag so only the site organizer sees "وضع المنظّم".
alter table profiles add column if not exists is_admin boolean not null default false;

-- Make your own account the admin (organizer). This finds your profile
-- by the email you registered with and sets is_admin to true.
update profiles
set is_admin = true
where id = (select id from auth.users where email = 'abdullahwaleedhs@gmail.com');
