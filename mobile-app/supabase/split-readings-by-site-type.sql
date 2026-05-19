alter table public.readings
add column if not exists chlorination_power_kwh numeric;

alter table public.readings
add column if not exists peroxide_consumption numeric;

create table if not exists public.chlorination_readings (
  id uuid primary key default gen_random_uuid(),
  site_id bigint not null references public.sites (id) on delete restrict,
  submitted_by uuid not null references public.profiles (id) on delete restrict,
  reading_datetime timestamptz not null,
  slot_datetime timestamptz not null,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  remarks text,
  totalizer numeric,
  pressure_psi numeric,
  rc_ppm numeric,
  turbidity_ntu numeric,
  ph numeric,
  tds_ppm numeric,
  tank_level_liters numeric,
  flowrate_m3hr numeric,
  chlorine_consumed numeric,
  peroxide_consumption numeric,
  chlorination_power_kwh numeric,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.chlorination_readings
add column if not exists peroxide_consumption numeric;

create unique index if not exists chlorination_readings_site_slot_unique
on public.chlorination_readings (site_id, slot_datetime);

create table if not exists public.deepwell_readings (
  id uuid primary key default gen_random_uuid(),
  site_id bigint not null references public.sites (id) on delete restrict,
  submitted_by uuid not null references public.profiles (id) on delete restrict,
  reading_datetime timestamptz not null,
  slot_datetime timestamptz not null,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  remarks text,
  upstream_pressure_psi numeric,
  downstream_pressure_psi numeric,
  flowrate_m3hr numeric,
  vfd_frequency_hz numeric,
  voltage_l1_v numeric,
  voltage_l2_v numeric,
  voltage_l3_v numeric,
  amperage_a numeric,
  tds_ppm numeric,
  power_kwh_shift numeric,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists deepwell_readings_site_slot_unique
on public.deepwell_readings (site_id, slot_datetime);

drop trigger if exists chlorination_readings_set_updated_at on public.chlorination_readings;
create trigger chlorination_readings_set_updated_at
before update on public.chlorination_readings
for each row execute procedure public.set_updated_at();

drop trigger if exists deepwell_readings_set_updated_at on public.deepwell_readings;
create trigger deepwell_readings_set_updated_at
before update on public.deepwell_readings
for each row execute procedure public.set_updated_at();

alter table public.chlorination_readings enable row level security;
alter table public.deepwell_readings enable row level security;

drop policy if exists "approved users can read chlorination readings" on public.chlorination_readings;
create policy "approved users can read chlorination readings"
on public.chlorination_readings
for select
using (
  auth.uid() is not null
  and public.is_approved_user()
);

drop policy if exists "approved users can insert chlorination readings" on public.chlorination_readings;
create policy "approved users can insert chlorination readings"
on public.chlorination_readings
for insert
with check (
  submitted_by = auth.uid()
  and auth.uid() is not null
  and public.is_approved_user()
);

drop policy if exists "chlorination readings admin update" on public.chlorination_readings;
create policy "chlorination readings admin update"
on public.chlorination_readings
for update
using (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'))
with check (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'));

drop policy if exists "approved users can update own chlorination readings" on public.chlorination_readings;
create policy "approved users can update own chlorination readings"
on public.chlorination_readings
for update
using (
  submitted_by = auth.uid()
  and auth.uid() is not null
  and public.is_approved_user()
)
with check (
  submitted_by = auth.uid()
  and auth.uid() is not null
  and public.is_approved_user()
);

drop policy if exists "approved users can read deepwell readings" on public.deepwell_readings;
create policy "approved users can read deepwell readings"
on public.deepwell_readings
for select
using (
  auth.uid() is not null
  and public.is_approved_user()
);

drop policy if exists "approved users can insert deepwell readings" on public.deepwell_readings;
create policy "approved users can insert deepwell readings"
on public.deepwell_readings
for insert
with check (
  submitted_by = auth.uid()
  and auth.uid() is not null
  and public.is_approved_user()
);

drop policy if exists "deepwell readings admin update" on public.deepwell_readings;
create policy "deepwell readings admin update"
on public.deepwell_readings
for update
using (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'))
with check (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'));

drop policy if exists "approved users can update own deepwell readings" on public.deepwell_readings;
create policy "approved users can update own deepwell readings"
on public.deepwell_readings
for update
using (
  submitted_by = auth.uid()
  and auth.uid() is not null
  and public.is_approved_user()
)
with check (
  submitted_by = auth.uid()
  and auth.uid() is not null
  and public.is_approved_user()
);

insert into public.chlorination_readings (
  id,
  site_id,
  submitted_by,
  reading_datetime,
  slot_datetime,
  status,
  remarks,
  totalizer,
  pressure_psi,
  rc_ppm,
  turbidity_ntu,
  ph,
  tds_ppm,
  tank_level_liters,
  flowrate_m3hr,
  chlorine_consumed,
  peroxide_consumption,
  chlorination_power_kwh,
  created_at,
  updated_at
)
select
  id,
  site_id,
  submitted_by,
  reading_datetime,
  slot_datetime,
  status,
  remarks,
  totalizer,
  pressure_psi,
  rc_ppm,
  turbidity_ntu,
  ph,
  tds_ppm,
  tank_level_liters,
  flowrate_m3hr,
  chlorine_consumed,
  peroxide_consumption,
  chlorination_power_kwh,
  created_at,
  updated_at
from public.readings
where site_type = 'CHLORINATION'
on conflict (id) do nothing;

insert into public.deepwell_readings (
  id,
  site_id,
  submitted_by,
  reading_datetime,
  slot_datetime,
  status,
  remarks,
  upstream_pressure_psi,
  downstream_pressure_psi,
  flowrate_m3hr,
  vfd_frequency_hz,
  voltage_l1_v,
  voltage_l2_v,
  voltage_l3_v,
  amperage_a,
  tds_ppm,
  power_kwh_shift,
  created_at,
  updated_at
)
select
  id,
  site_id,
  submitted_by,
  reading_datetime,
  slot_datetime,
  status,
  remarks,
  upstream_pressure_psi,
  downstream_pressure_psi,
  flowrate_m3hr,
  vfd_frequency_hz,
  voltage_l1_v,
  voltage_l2_v,
  voltage_l3_v,
  amperage_a,
  tds_ppm,
  power_kwh_shift,
  created_at,
  updated_at
from public.readings
where site_type = 'DEEPWELL'
on conflict (id) do nothing;
