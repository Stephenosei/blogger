// Shared Supabase client loader and safe DOM/URL utilities
(function () {
  let configPromise = null;
  let clientInstance = null;

  async function fetchPublicConfig() {
    if (!configPromise) {
      configPromise = fetch('/api/public-config', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : { supabaseUrl: '', supabaseAnonKey: '', configured: false }))
        .catch(() => ({ supabaseUrl: '', supabaseAnonKey: '', configured: false }));
    }
    return configPromise;
  }

  async function getSupabase() {
    const cfg = await fetchPublicConfig();
    if (!cfg.configured || !cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
      return { client: null, configured: false, config: cfg };
    }
    if (!clientInstance) {
      clientInstance = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    }
    return { client: clientInstance, configured: true, config: cfg };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(url, fallback = '#') {
    const raw = String(url ?? '').trim();
    if (!raw) return fallback;
    if (raw === '#') return '#';
    if (/^(https?:\/\/|\/|img\/|\.\.?\/)/i.test(raw)) {
      return raw;
    }
    return fallback;
  }

  function mediaUrl(url, fallback = '/img/frontpik2.jpg') {
    const checked = safeUrl(url, fallback);
    if (!checked || checked === '#') return fallback;
    if (/^https?:\/\//i.test(checked) || checked.startsWith('/')) {
      return checked;
    }
    return '/' + checked.replace(/^\.\//, '');
  }

  function slugify(input) {
    return String(input || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function formatDate(iso, fallbackLabel) {
    if (fallbackLabel) return fallbackLabel;
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso));
    } catch {
      return '';
    }
  }

  function estimateReadTime(paragraphs) {
    const text = Array.isArray(paragraphs) ? paragraphs.join(' ') : String(paragraphs || '');
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const mins = Math.max(1, Math.round(words / 210));
    return `${mins} min read`;
  }

  function storyHref(article) {
    if (!article) return '/stories.html';
    if (article.slug) {
      return `/story.html?slug=${encodeURIComponent(article.slug)}`;
    }
    if (article.legacy_path) {
      return `/${encodeURI(article.legacy_path)}`;
    }
    return '/stories.html';
  }

  window.BMNSupabase = {
    fetchPublicConfig,
    getSupabase,
    escapeHtml,
    safeUrl,
    mediaUrl,
    slugify,
    formatDate,
    estimateReadTime,
    storyHref,
  };
})();
