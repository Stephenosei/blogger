-- 005_storage_buckets.sql
-- Public-read blog-media bucket with authenticated staff upload and management policies

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'blog-media',
  'blog-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view blog media" on storage.objects;
create policy "Public can view blog media"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'blog-media');

drop policy if exists "Active staff can upload blog media" on storage.objects;
create policy "Active staff can upload blog media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'blog-media'
    and public.is_active_staff()
  );

drop policy if exists "Content and super admins can update blog media" on storage.objects;
create policy "Content and super admins can update blog media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'blog-media'
    and (public.has_staff_role(array['super_admin', 'content_admin']) or owner = auth.uid())
  )
  with check (
    bucket_id = 'blog-media'
    and (public.has_staff_role(array['super_admin', 'content_admin']) or owner = auth.uid())
  );

drop policy if exists "Content and super admins can delete blog media" on storage.objects;
create policy "Content and super admins can delete blog media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'blog-media'
    and (public.has_staff_role(array['super_admin', 'content_admin']) or owner = auth.uid())
  );
