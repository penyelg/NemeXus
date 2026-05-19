alter table public.profiles
add column if not exists is_approved boolean not null default false;

alter table public.profiles
add column if not exists approved_at timestamptz;

alter table public.profiles
add column if not exists approved_by uuid references public.profiles (id) on delete set null;

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

drop trigger if exists profiles_protect_admin_fields on public.profiles;
create trigger profiles_protect_admin_fields
before update on public.profiles
for each row execute procedure public.protect_profile_admin_fields();

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

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update"
on public.profiles
for update
using (auth.uid() = id or public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'))
with check (auth.uid() = id or public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'));

drop policy if exists "all active users can select sites" on public.sites;
create policy "approved users can select sites"
on public.sites
for select
using (
  auth.uid() is not null
  and public.is_approved_user()
);

drop policy if exists "site assignments self select" on public.site_assignments;
create policy "site assignments self select"
on public.site_assignments
for select
using (
  user_id = auth.uid()
  or public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager')
);

drop policy if exists "users can read own readings or elevated roles" on public.readings;
drop policy if exists "approved users can read readings" on public.readings;
create policy "approved users can read readings"
on public.readings
for select
using (
  auth.uid() is not null
  and public.is_approved_user()
);

drop policy if exists "active users can insert their own readings" on public.readings;
create policy "approved users can insert their own readings"
on public.readings
for insert
with check (
  submitted_by = auth.uid()
  and auth.uid() is not null
  and public.is_approved_user()
);

drop policy if exists "readings admin update" on public.readings;
create policy "readings admin update"
on public.readings
for update
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
