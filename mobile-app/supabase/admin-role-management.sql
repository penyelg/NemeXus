create or replace function public.is_admin_user()
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
      and role = 'admin'
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

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update"
on public.profiles
for update
using (auth.uid() = id or public.current_role() in ('admin', 'general_manager'))
with check (auth.uid() = id or public.current_role() in ('admin', 'general_manager'));
