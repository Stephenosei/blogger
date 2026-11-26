-- 001_core_rbac_and_profiles.sql
-- Core RBAC profiles, helper functions, triggers, and strict Row Level Security

create extension if not exists pgcrypto;

-- Profiles table tied 1:1 to auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  avatar_url text not null default '',
  role text not null default 'editor' check (role in ('super_admin', 'content_admin', 'editor')),
  is_active boolean not null default false,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_active on public.profiles(is_active);

-- Generic updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Helper functions evaluated in RLS policies (SECURITY DEFINER avoids recursive RLS loops)
create or replace function public.is_active_staff()
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
  );
$$;

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and is_active = true
  limit 1;
$$;

create or replace function public.has_staff_role(allowed_roles text[])
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
      and role = any(allowed_roles)
  );
$$;

-- Automatically provision profile row when a new auth.users record is created
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_super_admin boolean;
  v_invited_role text;
  v_role text := 'editor';
  v_active boolean := false;
  v_name text;
begin
  select exists(
    select 1 from public.profiles where role = 'super_admin' and is_active = true
  ) into v_has_super_admin;

  v_invited_role := new.raw_app_meta_data ->> 'invited_role';
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(new.email, 'admin'), '@', 1)
  );

  if v_invited_role in ('super_admin', 'content_admin', 'editor') then
    v_role := v_invited_role;
    v_active := true;
  elsif not v_has_super_admin and lower(coalesce(new.email, '')) = 'steveosei998@gmail.com' then
    -- Initial owner bootstrap only when no active super_admin exists yet
    v_role := 'super_admin';
    v_active := true;
  end if;

  insert into public.profiles (id, email, full_name, role, is_active)
  values (new.id, lower(new.email), v_name, v_role, v_active)
  on conflict (id) do update
    set email = excluded.email,
        full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Prevent privilege escalation: non-super_admin users cannot change role or is_active
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow direct SQL/service_role operations where auth.uid() is null
  if auth.uid() is not null and not public.has_staff_role(array['super_admin']) then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active or new.email is distinct from old.email then
      raise exception 'Only an active Super Administrator may modify role, activation status, or email.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_role_self_escalation on public.profiles;
create trigger trg_prevent_role_self_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_self_escalation();

-- Enable RLS
alter table public.profiles enable row level security;

-- Policies for profiles
drop policy if exists "Active staff can view team profiles" on public.profiles;
create policy "Active staff can view team profiles"
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid() or public.is_active_staff()
  );

drop policy if exists "Users can update own non-privileged profile fields" on public.profiles;
create policy "Users can update own non-privileged profile fields"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() and is_active = true)
  with check (id = auth.uid());

drop policy if exists "Super admins can manage all profiles" on public.profiles;
create policy "Super admins can manage all profiles"
  on public.profiles for all
  to authenticated
  using (public.has_staff_role(array['super_admin']))
  with check (public.has_staff_role(array['super_admin']));
