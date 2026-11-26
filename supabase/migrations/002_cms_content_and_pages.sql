-- 002_cms_content_and_pages.sql
-- Categories, Tags, Articles, Announcements/Upcoming Updates, Site Pages, Media Assets & RLS

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  description text not null default '',
  accent_color text not null default '#1936ca',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_categories_updated_at on public.categories;
create trigger trg_categories_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 50),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  created_at timestamptz not null default now()
);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 220),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  excerpt text not null default '',
  content_paragraphs jsonb not null default '[]'::jsonb,
  content_html text not null default '',
  author_pen_name text not null default 'Editorial Team',
  category_id uuid not null references public.categories(id) on delete restrict,
  cover_image_url text not null default '',
  thumbnail_url text not null default '',
  legacy_path text,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'published', 'archived')),
  is_featured boolean not null default false,
  display_date_label text not null default '',
  published_at timestamptz,
  likes_count integer not null default 0 check (likes_count >= 0),
  views_count integer not null default 0 check (views_count >= 0),
  author_id uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_articles_status_published on public.articles(status, published_at desc);
create index if not exists idx_articles_category on public.articles(category_id);
create index if not exists idx_articles_legacy_path on public.articles(legacy_path);

drop trigger if exists trg_articles_updated_at on public.articles;
create trigger trg_articles_updated_at
  before update on public.articles
  for each row execute function public.set_updated_at();

create table if not exists public.article_tags (
  article_id uuid not null references public.articles(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (article_id, tag_id)
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 180),
  summary text not null default '',
  category_label text not null default 'what will you do?',
  image_url text not null default '',
  kind text not null default 'upcoming_update' check (kind in ('upcoming_update', 'site_banner')),
  cta_label text not null default '',
  cta_url text not null default '',
  is_active boolean not null default true,
  display_order integer not null default 0,
  published_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_announcements_updated_at on public.announcements;
create trigger trg_announcements_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9_-]+$'),
  title text not null,
  subtitle text not null default '',
  body jsonb not null default '{}'::jsonb,
  is_published boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_site_pages_updated_at on public.site_pages;
create trigger trg_site_pages_updated_at
  before update on public.site_pages
  for each row execute function public.set_updated_at();

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  storage_path text not null unique,
  public_url text not null,
  alt_text text not null default '',
  bucket_name text not null default 'blog-media',
  mime_type text not null default 'image/jpeg',
  file_size integer not null default 0,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Public-safe RPCs for article likes and view counts (no broad UPDATE granted to anon)
create or replace function public.increment_article_like(p_slug text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_likes integer;
begin
  update public.articles
  set likes_count = likes_count + 1
  where slug = p_slug and status = 'published'
  returning likes_count into v_likes;

  return coalesce(v_likes, 0);
end;
$$;

create or replace function public.increment_article_view(p_slug text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_views integer;
begin
  update public.articles
  set views_count = views_count + 1
  where slug = p_slug and status = 'published'
  returning views_count into v_views;

  return coalesce(v_views, 0);
end;
$$;

grant execute on function public.increment_article_like(text) to anon, authenticated;
grant execute on function public.increment_article_view(text) to anon, authenticated;

-- Enable RLS
alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.articles enable row level security;
alter table public.article_tags enable row level security;
alter table public.announcements enable row level security;
alter table public.site_pages enable row level security;
alter table public.media_assets enable row level security;

-- Categories RLS
drop policy if exists "Public can read categories" on public.categories;
create policy "Public can read categories"
  on public.categories for select
  to anon, authenticated
  using (true);

drop policy if exists "Content and super admins can manage categories" on public.categories;
create policy "Content and super admins can manage categories"
  on public.categories for all
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']))
  with check (public.has_staff_role(array['super_admin', 'content_admin']));

-- Tags RLS
drop policy if exists "Public can read tags" on public.tags;
create policy "Public can read tags"
  on public.tags for select
  to anon, authenticated
  using (true);

drop policy if exists "Staff can insert tags" on public.tags;
create policy "Staff can insert tags"
  on public.tags for insert
  to authenticated
  with check (public.is_active_staff());

drop policy if exists "Content and super admins can update or delete tags" on public.tags;
create policy "Content and super admins can update or delete tags"
  on public.tags for update
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']))
  with check (public.has_staff_role(array['super_admin', 'content_admin']));

drop policy if exists "Content and super admins can delete tags" on public.tags;
create policy "Content and super admins can delete tags"
  on public.tags for delete
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']));

-- Articles RLS
drop policy if exists "Public can read published articles" on public.articles;
create policy "Public can read published articles"
  on public.articles for select
  to anon
  using (status = 'published');

drop policy if exists "Authenticated readers see published and staff see all" on public.articles;
create policy "Authenticated readers see published and staff see all"
  on public.articles for select
  to authenticated
  using (status = 'published' or public.is_active_staff());

drop policy if exists "Editors can create draft or in-review articles" on public.articles;
create policy "Editors can create draft or in-review articles"
  on public.articles for insert
  to authenticated
  with check (
    public.has_staff_role(array['editor'])
    and status in ('draft', 'in_review')
    and (author_id is null or author_id = auth.uid())
  );

drop policy if exists "Editors can update own unpublished articles" on public.articles;
create policy "Editors can update own unpublished articles"
  on public.articles for update
  to authenticated
  using (
    public.has_staff_role(array['editor'])
    and author_id = auth.uid()
    and status in ('draft', 'in_review')
  )
  with check (
    public.has_staff_role(array['editor'])
    and author_id = auth.uid()
    and status in ('draft', 'in_review')
  );

drop policy if exists "Content and super admins have full article access" on public.articles;
create policy "Content and super admins have full article access"
  on public.articles for all
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']))
  with check (public.has_staff_role(array['super_admin', 'content_admin']));

-- Article Tags RLS
drop policy if exists "Public can read tags on published articles" on public.article_tags;
create policy "Public can read tags on published articles"
  on public.article_tags for select
  to anon, authenticated
  using (
    public.is_active_staff()
    or exists (
      select 1 from public.articles a
      where a.id = article_id and a.status = 'published'
    )
  );

drop policy if exists "Content and super admins manage article tags" on public.article_tags;
create policy "Content and super admins manage article tags"
  on public.article_tags for all
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']))
  with check (public.has_staff_role(array['super_admin', 'content_admin']));

drop policy if exists "Editors manage tags on own drafts" on public.article_tags;
create policy "Editors manage tags on own drafts"
  on public.article_tags for all
  to authenticated
  using (
    public.has_staff_role(array['editor'])
    and exists (
      select 1 from public.articles a
      where a.id = article_id and a.author_id = auth.uid() and a.status in ('draft', 'in_review')
    )
  )
  with check (
    public.has_staff_role(array['editor'])
    and exists (
      select 1 from public.articles a
      where a.id = article_id and a.author_id = auth.uid() and a.status in ('draft', 'in_review')
    )
  );

-- Announcements RLS
drop policy if exists "Public can read active announcements" on public.announcements;
create policy "Public can read active announcements"
  on public.announcements for select
  to anon
  using (is_active = true);

drop policy if exists "Authenticated read active announcements and staff read all" on public.announcements;
create policy "Authenticated read active announcements and staff read all"
  on public.announcements for select
  to authenticated
  using (is_active = true or public.is_active_staff());

drop policy if exists "Content and super admins manage announcements" on public.announcements;
create policy "Content and super admins manage announcements"
  on public.announcements for all
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']))
  with check (public.has_staff_role(array['super_admin', 'content_admin']));

-- Site Pages RLS
drop policy if exists "Public can read published site pages" on public.site_pages;
create policy "Public can read published site pages"
  on public.site_pages for select
  to anon, authenticated
  using (is_published = true or public.is_active_staff());

drop policy if exists "Content and super admins update site pages" on public.site_pages;
create policy "Content and super admins update site pages"
  on public.site_pages for insert
  to authenticated
  with check (public.has_staff_role(array['super_admin', 'content_admin']));

drop policy if exists "Content and super admins edit site pages" on public.site_pages;
create policy "Content and super admins edit site pages"
  on public.site_pages for update
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']))
  with check (public.has_staff_role(array['super_admin', 'content_admin']));

drop policy if exists "Super admins delete site pages" on public.site_pages;
create policy "Super admins delete site pages"
  on public.site_pages for delete
  to authenticated
  using (public.has_staff_role(array['super_admin']));

-- Media Assets RLS
drop policy if exists "Public can read media assets" on public.media_assets;
create policy "Public can read media assets"
  on public.media_assets for select
  to anon, authenticated
  using (true);

drop policy if exists "Active staff can register uploaded media" on public.media_assets;
create policy "Active staff can register uploaded media"
  on public.media_assets for insert
  to authenticated
  with check (public.is_active_staff());

drop policy if exists "Content and super admins manage media assets" on public.media_assets;
create policy "Content and super admins manage media assets"
  on public.media_assets for update
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']) or uploaded_by = auth.uid())
  with check (public.has_staff_role(array['super_admin', 'content_admin']) or uploaded_by = auth.uid());

drop policy if exists "Content and super admins delete media assets" on public.media_assets;
create policy "Content and super admins delete media assets"
  on public.media_assets for delete
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']) or uploaded_by = auth.uid());
