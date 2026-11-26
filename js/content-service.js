// Public content data service backed by Supabase with graceful fallback to preserved catalog
(function () {
  const getLegacy = () => window.BMN_LEGACY_CATALOG || { categories: [], articles: [], announcements: [], pages: {} };

  function normalizeArticle(row) {
    if (!row) return null;
    const catSlug = row.categories?.slug || row.category_slug || 'relationship';
    const catName = row.categories?.name || (catSlug === 'what-will-you-do' ? 'What Will You Do?' : catSlug === 'love-journey' ? 'Love Journey' : 'Relationship');
    const paragraphs = Array.isArray(row.content_paragraphs) && row.content_paragraphs.length
      ? row.content_paragraphs
      : Array.isArray(row.paragraphs)
        ? row.paragraphs
        : [];
    return {
      id: row.id || row.slug,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt || (paragraphs[0] ? paragraphs[0].slice(0, 220) + '...' : ''),
      paragraphs,
      content_html: row.content_html || '',
      author_pen_name: row.author_pen_name || 'Editorial Team',
      category_slug: catSlug,
      category_name: catName,
      cover_image_url: row.cover_image_url || row.thumbnail_url || 'img/frontpik2.jpg',
      thumbnail_url: row.thumbnail_url || row.cover_image_url || 'img/frontpik2.jpg',
      legacy_path: row.legacy_path || '',
      is_featured: Boolean(row.is_featured),
      display_date_label: row.display_date_label || window.BMNSupabase.formatDate(row.published_at),
      published_at: row.published_at || new Date().toISOString(),
      likes_count: Number(row.likes_count || 0),
      views_count: Number(row.views_count || 0),
      tags: Array.isArray(row.article_tags)
        ? row.article_tags.map((t) => t.tags).filter(Boolean)
        : [],
    };
  }

  async function fetchCategories() {
    const legacy = getLegacy().categories;
    const { client, configured } = await window.BMNSupabase.getSupabase();
    if (!configured) return { items: legacy, source: 'fallback' };
    try {
      const { data, error } = await client.from('categories').select('*').order('sort_order', { ascending: true });
      if (error || !data || !data.length) return { items: legacy, source: 'fallback' };
      return { items: data, source: 'supabase' };
    } catch {
      return { items: legacy, source: 'fallback' };
    }
  }

  async function fetchPublishedArticles() {
    const legacy = getLegacy().articles.map(normalizeArticle);
    const { client, configured } = await window.BMNSupabase.getSupabase();
    if (!configured) return { items: legacy, source: 'fallback' };
    try {
      const { data, error } = await client
        .from('articles')
        .select('*, categories(name, slug), article_tags(tags(name, slug))')
        .eq('status', 'published')
        .order('is_featured', { ascending: false })
        .order('published_at', { ascending: false });

      if (error || !data || !data.length) return { items: legacy, source: 'fallback' };
      return { items: data.map(normalizeArticle), source: 'supabase' };
    } catch {
      return { items: legacy, source: 'fallback' };
    }
  }

  async function fetchArticleBySlugOrPath(slugOrPath) {
    const clean = String(slugOrPath || '').trim().toLowerCase();
    const legacyList = getLegacy().articles.map(normalizeArticle);
    const legacyMatch = legacyList.find(
      (a) => a.slug.toLowerCase() === clean || (a.legacy_path && a.legacy_path.toLowerCase() === clean)
    );

    const { client, configured } = await window.BMNSupabase.getSupabase();
    if (!configured) return { article: legacyMatch || null, source: 'fallback' };

    try {
      const { data, error } = await client
        .from('articles')
        .select('*, categories(name, slug), article_tags(tags(name, slug))')
        .eq('status', 'published')
        .or(`slug.eq.${clean},legacy_path.ilike.${clean}`)
        .limit(1)
        .maybeSingle();

      if (error || !data) return { article: legacyMatch || null, source: 'fallback' };
      return { article: normalizeArticle(data), source: 'supabase' };
    } catch {
      return { article: legacyMatch || null, source: 'fallback' };
    }
  }

  async function fetchAnnouncements() {
    const legacy = getLegacy().announcements || [];
    const { client, configured } = await window.BMNSupabase.getSupabase();
    if (!configured) return { items: legacy, source: 'fallback' };
    try {
      const { data, error } = await client
        .from('announcements')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .order('published_at', { ascending: false });
      if (error || !data) return { items: legacy, source: 'fallback' };
      return { items: data, source: 'supabase' };
    } catch {
      return { items: legacy, source: 'fallback' };
    }
  }

  async function fetchSitePages() {
    const legacy = getLegacy().pages || {};
    const { client, configured } = await window.BMNSupabase.getSupabase();
    if (!configured) return { pages: legacy, source: 'fallback' };
    try {
      const { data, error } = await client.from('site_pages').select('*').eq('is_published', true);
      if (error || !data || !data.length) return { pages: legacy, source: 'fallback' };
      const mapped = { ...legacy };
      for (const row of data) {
        mapped[row.slug] = row.body || {};
      }
      return { pages: mapped, source: 'supabase' };
    } catch {
      return { pages: legacy, source: 'fallback' };
    }
  }

  async function fetchApprovedComments(articleId) {
    const { client, configured } = await window.BMNSupabase.getSupabase();
    if (!configured || !articleId || String(articleId).indexOf('-') === -1) return [];
    try {
      const { data, error } = await client
        .from('public_article_comments')
        .select('id, author_name, body, created_at')
        .eq('article_id', articleId)
        .order('created_at', { ascending: false });
      return error || !data ? [] : data;
    } catch {
      return [];
    }
  }

  async function submitComment({ articleId, authorName, authorEmail, body }) {
    const { client, configured } = await window.BMNSupabase.getSupabase();
    if (!configured) {
      throw new Error('Supabase is not configured yet. Connect SUPABASE_URL and SUPABASE_ANON_KEY to enable live comments.');
    }
    const { error } = await client.from('article_comments').insert({
      article_id: articleId,
      author_name: authorName.trim(),
      author_email: (authorEmail || '').trim(),
      body: body.trim(),
      status: 'pending',
    });
    if (error) throw new Error(error.message);
  }

  async function incrementLike(slug) {
    const { client, configured } = await window.BMNSupabase.getSupabase();
    if (!configured || !slug) return null;
    try {
      const { data, error } = await client.rpc('increment_article_like', { p_slug: slug });
      return error ? null : data;
    } catch {
      return null;
    }
  }

  async function incrementView(slug) {
    const { client, configured } = await window.BMNSupabase.getSupabase();
    if (!configured || !slug) return null;
    try {
      const { data, error } = await client.rpc('increment_article_view', { p_slug: slug });
      return error ? null : data;
    } catch {
      return null;
    }
  }

  async function submitReaderStory(payload) {
    const { client, configured } = await window.BMNSupabase.getSupabase();
    if (!configured) {
      throw new Error('Supabase is not configured yet. Configure SUPABASE_URL and SUPABASE_ANON_KEY to save submissions.');
    }
    const { error } = await client.from('reader_submissions').insert({
      submission_type: payload.submission_type,
      sender_name: payload.sender_name.trim(),
      sender_email: payload.sender_email.trim(),
      title: payload.title.trim(),
      category_slug: payload.category_slug,
      message_body: payload.message_body.trim(),
      consent_to_publish: Boolean(payload.consent_to_publish),
      status: 'new',
    });
    if (error) throw new Error(error.message);
  }

  window.BMNContent = {
    fetchCategories,
    fetchPublishedArticles,
    fetchArticleBySlugOrPath,
    fetchAnnouncements,
    fetchSitePages,
    fetchApprovedComments,
    submitComment,
    incrementLike,
    incrementView,
    submitReaderStory,
  };
})();
