-- 003_community_submissions_tasks_logs.sql
-- Reader submissions, article comments (with PII-isolated public view), tasks, notifications, and audit logs

create table if not exists public.reader_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_type text not null default 'story' check (submission_type in ('story', 'enquiry')),
  sender_name text not null check (char_length(trim(sender_name)) between 2 and 120),
  sender_email text not null check (sender_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(sender_email) <= 180),
  title text not null check (char_length(trim(title)) between 3 and 200),
  category_slug text not null default 'what-will-you-do',
  message_body text not null check (char_length(trim(message_body)) between 20 and 20000),
  consent_to_publish boolean not null default true,
  status text not null default 'new' check (status in ('new', 'reviewing', 'converted_to_draft', 'resolved', 'rejected')),
  reviewer_notes text not null default '',
  converted_article_id uuid references public.articles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_submissions_status on public.reader_submissions(status, created_at desc);

drop trigger if exists trg_submissions_updated_at on public.reader_submissions;
create trigger trg_submissions_updated_at
  before update on public.reader_submissions
  for each row execute function public.set_updated_at();

create table if not exists public.article_comments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  author_name text not null check (char_length(trim(author_name)) between 2 and 100),
  author_email text not null default '' check (author_email = '' or (author_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(author_email) <= 180)),
  body text not null check (char_length(trim(body)) between 3 and 3000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  moderated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_comments_article_status on public.article_comments(article_id, status, created_at desc);

-- Public-safe view for approved comments (excludes author_email PII)
create or replace view public.public_article_comments as
select
  c.id,
  c.article_id,
  c.author_name,
  c.body,
  c.created_at
from public.article_comments c
join public.articles a on a.id = c.article_id
where c.status = 'approved' and a.status = 'published';

grant select on public.public_article_comments to anon, authenticated;

create table if not exists public.editorial_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 3 and 200),
  description text not null default '',
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  assigned_to uuid references public.profiles(id) on delete set null,
  related_article_id uuid references public.articles(id) on delete set null,
  related_submission_id uuid references public.reader_submissions(id) on delete set null,
  due_date date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_status on public.editorial_tasks(status, priority);
create index if not exists idx_tasks_assignee on public.editorial_tasks(assigned_to);

drop trigger if exists trg_tasks_updated_at on public.editorial_tasks;
create trigger trg_tasks_updated_at
  before update on public.editorial_tasks
  for each row execute function public.set_updated_at();

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id) on delete cascade,
  target_role text not null default 'all' check (target_role in ('all', 'super_admin', 'content_admin', 'editor')),
  type text not null default 'system' check (type in ('new_submission', 'task_assigned', 'article_review', 'comment_pending', 'system')),
  title text not null,
  message text not null default '',
  link_section text not null default 'overview',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_unread on public.admin_notifications(is_read, created_at desc);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text not null default 'system',
  action text not null,
  entity_type text not null,
  entity_id text not null default '',
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_logs_created on public.activity_logs(created_at desc);

-- Triggers for automated notifications and immutable audit logs
create or replace function public.notify_on_new_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_notifications (target_role, type, title, message, link_section)
  values (
    'content_admin',
    'new_submission',
    case when new.submission_type = 'story' then 'New Reader Story Submitted' else 'New Reader Enquiry' end,
    new.sender_name || ' submitted "' || left(new.title, 80) || '"',
    'submissions'
  );
  insert into public.admin_notifications (target_role, type, title, message, link_section)
  values (
    'super_admin',
    'new_submission',
    case when new.submission_type = 'story' then 'New Reader Story Submitted' else 'New Reader Enquiry' end,
    new.sender_name || ' submitted "' || left(new.title, 80) || '"',
    'submissions'
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_submission on public.reader_submissions;
create trigger trg_notify_submission
  after insert on public.reader_submissions
  for each row execute function public.notify_on_new_submission();

create or replace function public.notify_on_new_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' then
    insert into public.admin_notifications (target_role, type, title, message, link_section)
    values (
      'content_admin',
      'comment_pending',
      'New Comment Awaiting Moderation',
      new.author_name || ' commented on a story.',
      'comments'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_comment on public.article_comments;
create trigger trg_notify_comment
  after insert on public.article_comments
  for each row execute function public.notify_on_new_comment();

create or replace function public.notify_on_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    insert into public.admin_notifications (recipient_id, target_role, type, title, message, link_section)
    values (
      new.assigned_to,
      'editor',
      'task_assigned',
      'Editorial Task Assigned',
      'Task: "' || left(new.title, 100) || '"',
      'tasks'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_task on public.editorial_tasks;
create trigger trg_notify_task
  after insert or update on public.editorial_tasks
  for each row execute function public.notify_on_task_assigned();

create or replace function public.log_article_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := 'system';
  v_action text;
begin
  if auth.uid() is not null then
    select email into v_email from public.profiles where id = auth.uid();
  end if;

  if tg_op = 'INSERT' then
    v_action := 'article.created';
    insert into public.activity_logs (actor_id, actor_email, action, entity_type, entity_id, summary)
    values (auth.uid(), coalesce(v_email, 'system'), v_action, 'article', new.id::text, 'Created article "' || new.title || '" (' || new.status || ')');
    return new;
  elsif tg_op = 'UPDATE' then
    -- Ignore anonymous like/view increments
    if new.title = old.title and new.status = old.status and new.content_paragraphs = old.content_paragraphs and new.excerpt = old.excerpt then
      return new;
    end if;
    if new.status is distinct from old.status then
      v_action := 'article.status_' || new.status;
    else
      v_action := 'article.updated';
    end if;
    insert into public.activity_logs (actor_id, actor_email, action, entity_type, entity_id, summary)
    values (auth.uid(), coalesce(v_email, 'system'), v_action, 'article', new.id::text, 'Updated article "' || new.title || '" (' || new.status || ')');
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.activity_logs (actor_id, actor_email, action, entity_type, entity_id, summary)
    values (auth.uid(), coalesce(v_email, 'system'), 'article.deleted', 'article', old.id::text, 'Deleted article "' || old.title || '"');
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_log_articles on public.articles;
create trigger trg_log_articles
  after insert or update or delete on public.articles
  for each row execute function public.log_article_changes();

-- Enable RLS
alter table public.reader_submissions enable row level security;
alter table public.article_comments enable row level security;
alter table public.editorial_tasks enable row level security;
alter table public.admin_notifications enable row level security;
alter table public.activity_logs enable row level security;

-- Reader Submissions RLS (public insert only; never readable by anon)
drop policy if exists "Public can submit stories or enquiries" on public.reader_submissions;
create policy "Public can submit stories or enquiries"
  on public.reader_submissions for insert
  to anon, authenticated
  with check (
    status = 'new'
    and converted_article_id is null
    and reviewed_by is null
  );

drop policy if exists "Active staff can view submissions" on public.reader_submissions;
create policy "Active staff can view submissions"
  on public.reader_submissions for select
  to authenticated
  using (public.is_active_staff());

drop policy if exists "Content and super admins manage submissions" on public.reader_submissions;
create policy "Content and super admins manage submissions"
  on public.reader_submissions for update
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']))
  with check (public.has_staff_role(array['super_admin', 'content_admin']));

drop policy if exists "Super admins delete submissions" on public.reader_submissions;
create policy "Super admins delete submissions"
  on public.reader_submissions for delete
  to authenticated
  using (public.has_staff_role(array['super_admin']));

-- Article Comments RLS (raw table with email is staff-only; public uses public_article_comments view)
drop policy if exists "Public can submit pending comments on published articles" on public.article_comments;
create policy "Public can submit pending comments on published articles"
  on public.article_comments for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and moderated_by is null
    and exists (
      select 1 from public.articles a where a.id = article_id and a.status = 'published'
    )
  );

drop policy if exists "Active staff can read all comments" on public.article_comments;
create policy "Active staff can read all comments"
  on public.article_comments for select
  to authenticated
  using (public.is_active_staff());

drop policy if exists "Content and super admins moderate comments" on public.article_comments;
create policy "Content and super admins moderate comments"
  on public.article_comments for update
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']))
  with check (public.has_staff_role(array['super_admin', 'content_admin']));

drop policy if exists "Content and super admins delete comments" on public.article_comments;
create policy "Content and super admins delete comments"
  on public.article_comments for delete
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']));

-- Editorial Tasks RLS
drop policy if exists "Active staff can read editorial tasks" on public.editorial_tasks;
create policy "Active staff can read editorial tasks"
  on public.editorial_tasks for select
  to authenticated
  using (public.is_active_staff());

drop policy if exists "Content and super admins manage all tasks" on public.editorial_tasks;
create policy "Content and super admins manage all tasks"
  on public.editorial_tasks for all
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']))
  with check (public.has_staff_role(array['super_admin', 'content_admin']));

drop policy if exists "Editors can update status of their assigned tasks" on public.editorial_tasks;
create policy "Editors can update status of their assigned tasks"
  on public.editorial_tasks for update
  to authenticated
  using (public.has_staff_role(array['editor']) and assigned_to = auth.uid())
  with check (public.has_staff_role(array['editor']) and assigned_to = auth.uid());

-- Admin Notifications RLS
drop policy if exists "Staff read their notifications" on public.admin_notifications;
create policy "Staff read their notifications"
  on public.admin_notifications for select
  to authenticated
  using (
    public.is_active_staff()
    and (
      recipient_id = auth.uid()
      or (recipient_id is null and (target_role = 'all' or target_role = public.current_staff_role() or public.has_staff_role(array['super_admin'])))
    )
  );

drop policy if exists "Staff mark their notifications read" on public.admin_notifications;
create policy "Staff mark their notifications read"
  on public.admin_notifications for update
  to authenticated
  using (
    public.is_active_staff()
    and (
      recipient_id = auth.uid()
      or (recipient_id is null and (target_role = 'all' or target_role = public.current_staff_role() or public.has_staff_role(array['super_admin'])))
    )
  )
  with check (public.is_active_staff());

drop policy if exists "Super and content admins create notifications" on public.admin_notifications;
create policy "Super and content admins create notifications"
  on public.admin_notifications for insert
  to authenticated
  with check (public.has_staff_role(array['super_admin', 'content_admin']));

-- Activity Logs RLS (append-only)
drop policy if exists "Content and super admins read activity logs" on public.activity_logs;
create policy "Content and super admins read activity logs"
  on public.activity_logs for select
  to authenticated
  using (public.has_staff_role(array['super_admin', 'content_admin']));

drop policy if exists "Active staff can append own activity logs" on public.activity_logs;
create policy "Active staff can append own activity logs"
  on public.activity_logs for insert
  to authenticated
  with check (public.is_active_staff() and actor_id = auth.uid());
