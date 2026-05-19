insert into public.sites (name, type)
values
  ('Main Chlorination Facility', 'CHLORINATION'),
  ('Main Deepwell Pump', 'DEEPWELL')
on conflict (name) do nothing;

create table if not exists public.daily_site_summaries (
  id uuid primary key default gen_random_uuid(),
  site_id bigint not null references public.sites (id) on delete restrict,
  summary_date date not null,
  source text not null default 'excel_daily_report',
  source_file text,
  production_m3 numeric,
  power_kwh numeric,
  chlorine_kg numeric,
  avg_flowrate_m3hr numeric,
  avg_pressure_psi numeric,
  avg_rc_ppm numeric,
  avg_turbidity_ntu numeric,
  avg_ph numeric,
  avg_tds_ppm numeric,
  peroxide_liters numeric,
  operating_hours numeric,
  scheduled_downtime_hours numeric,
  unscheduled_downtime_hours numeric,
  avg_upstream_pressure_psi numeric,
  avg_downstream_pressure_psi numeric,
  avg_vfd_frequency_hz numeric,
  avg_voltage_l1_v numeric,
  avg_voltage_l2_v numeric,
  avg_voltage_l3_v numeric,
  avg_amperage_a numeric,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (site_id, summary_date)
);

create index if not exists daily_site_summaries_date_idx
on public.daily_site_summaries (summary_date);

create index if not exists daily_site_summaries_site_date_idx
on public.daily_site_summaries (site_id, summary_date);

drop trigger if exists daily_site_summaries_set_updated_at on public.daily_site_summaries;
create trigger daily_site_summaries_set_updated_at
before update on public.daily_site_summaries
for each row execute procedure public.set_updated_at();

alter table public.daily_site_summaries enable row level security;

drop policy if exists "approved users can read daily site summaries" on public.daily_site_summaries;
create policy "approved users can read daily site summaries"
on public.daily_site_summaries
for select
using (
  auth.uid() is not null
  and public.is_approved_user()
);

drop policy if exists "office roles can manage daily site summaries" on public.daily_site_summaries;
create policy "office roles can manage daily site summaries"
on public.daily_site_summaries
for all
using (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'))
with check (public.current_role() in ('admin', 'supervisor', 'manager', 'general_manager'));
