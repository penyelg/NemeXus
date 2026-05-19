alter table public.profiles
drop constraint if exists profiles_role_check;

alter table public.profiles
add constraint profiles_role_check check (role in ('operator', 'supervisor', 'manager', 'general_manager', 'admin'));

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
        is_approved = true
        or role in ('supervisor', 'manager', 'general_manager', 'admin')
      )
  )
$$;

create or replace function public.is_account_manager_user()
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
      and role in ('admin', 'general_manager')
  )
$$;

create or replace function public.protect_profile_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and coalesce(public.current_role(), 'operator') not in ('admin', 'supervisor', 'manager', 'general_manager') then
    if new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.is_approved is distinct from old.is_approved
      or new.approved_at is distinct from old.approved_at
      or new.approved_by is distinct from old.approved_by then
      raise exception 'Only a manager, supervisor, general manager, or admin can change approval or role fields.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.approve_operator_account(target_profile_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_profile public.profiles;
begin
  if not public.is_account_manager_user() then
    raise exception 'Only admins and general managers can approve operator accounts.';
  end if;

  update public.profiles
  set
    is_approved = true,
    is_active = true,
    approved_at = timezone('utc', now()),
    approved_by = auth.uid(),
    updated_at = timezone('utc', now())
  where id = target_profile_id
    and role = 'operator'
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'Operator profile not found.';
  end if;

  return updated_profile;
end;
$$;

create or replace function public.assign_profile_role(target_profile_id uuid, next_role text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_role text := lower(trim(next_role));
  updated_profile public.profiles;
begin
  if not public.is_account_manager_user() then
    raise exception 'Only admins and general managers can assign office roles.';
  end if;

  if target_profile_id = auth.uid() and normalized_role not in ('admin', 'general_manager') then
    raise exception 'Account managers cannot remove their own account management role from the dashboard.';
  end if;

  if normalized_role not in ('operator', 'supervisor', 'manager', 'general_manager', 'admin') then
    raise exception 'Invalid role.';
  end if;

  update public.profiles
  set
    role = normalized_role,
    is_active = true,
    is_approved = case
      when normalized_role = 'operator' then is_approved
      else true
    end,
    approved_at = case
      when normalized_role = 'operator' then approved_at
      else coalesce(approved_at, timezone('utc', now()))
    end,
    approved_by = case
      when normalized_role = 'operator' then approved_by
      else coalesce(approved_by, auth.uid())
    end,
    updated_at = timezone('utc', now())
  where id = target_profile_id
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'Profile not found.';
  end if;

  return updated_profile;
end;
$$;

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

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update"
on public.profiles
for update
using (auth.uid() = id or public.current_role() in ('admin', 'general_manager'))
with check (auth.uid() = id or public.current_role() in ('admin', 'general_manager'));

drop policy if exists "site assignments self select" on public.site_assignments;
create policy "site assignments self select"
on public.site_assignments
for select
using (
  user_id = auth.uid()
  or public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager')
);

drop policy if exists "readings admin update" on public.readings;
create policy "readings admin update"
on public.readings
for update
using (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'))
with check (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'));

drop policy if exists "chlorination readings admin update" on public.chlorination_readings;
create policy "chlorination readings admin update"
on public.chlorination_readings
for update
using (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'))
with check (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'));

drop policy if exists "deepwell readings admin update" on public.deepwell_readings;
create policy "deepwell readings admin update"
on public.deepwell_readings
for update
using (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'))
with check (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'));

drop policy if exists "office roles can manage daily site summaries" on public.daily_site_summaries;
create policy "office roles can manage daily site summaries"
on public.daily_site_summaries
for all
using (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'))
with check (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'));

drop policy if exists "reading audit visible to supervisors" on public.reading_audit_log;
create policy "reading audit visible to supervisors"
on public.reading_audit_log
for select
using (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'));

update public.profiles
set
  is_approved = true,
  approved_at = coalesce(approved_at, timezone('utc', now()))
where role in ('admin', 'supervisor', 'manager', 'general_manager');
