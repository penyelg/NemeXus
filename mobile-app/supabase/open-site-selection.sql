create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_active = true
  )
$$;

create or replace function public.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_active = true
      and (
        coalesce(is_approved, false) = true
        or role in ('supervisor', 'manager', 'general_manager', 'admin')
      )
  )
$$;

drop policy if exists "assigned sites select" on public.sites;
create policy "all active users can select sites"
on public.sites
for select
using (
  auth.uid() is not null
  and public.is_approved_user()
);

drop policy if exists "profiles self select" on public.profiles;
drop policy if exists "approved users can read basic profiles" on public.profiles;
create policy "approved users can read basic profiles"
on public.profiles
for select
using (
  (
    auth.uid() = id
    or public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager')
  )
  or (
    auth.uid() is not null
    and public.is_approved_user()
  )
);

drop policy if exists "readings select" on public.readings;
drop policy if exists "users can read own readings or elevated roles" on public.readings;
drop policy if exists "approved users can read readings" on public.readings;
create policy "approved users can read readings"
on public.readings
for select
using (
  auth.uid() is not null
  and public.is_approved_user()
);

drop policy if exists "readings insert own assigned sites" on public.readings;
create policy "active users can insert their own readings"
on public.readings
for insert
with check (
  submitted_by = auth.uid()
  and auth.uid() is not null
  and public.is_approved_user()
);
