// Enhances preserved R-*.html and wwyd-*.html story pages with live Supabase CMS updates, likes, and comments
(function () {
  function getCurrentFile() {
    const seg = decodeURIComponent(window.location.pathname.split('/').pop() || '');
    return seg;
  }

  async function initLegacyStoryBridge() {
    const fileName = getCurrentFile();
    if (!fileName || (!fileName.startsWith('R-') && !fileName.startsWith('wwyd-'))) return;

    const { escapeHtml, mediaUrl } = window.BMNSupabase;
    const slug = fileName.replace(/\.html$/i, '').toLowerCase();

    // Inject editorial CSS for unified header/footer and engagement block
    if (!document.querySelector('link[href="/css/editorial.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/css/editorial.css';
      document.head.appendChild(link);
    }

    // Replace legacy header/footer with unified hosts if present
    const legacyHeader = document.querySelector('header.default-header');
    if (legacyHeader) {
      const host = document.createElement('div');
      host.id = 'bmn-header-host';
      legacyHeader.replaceWith(host);
    }
    const legacyFooter = document.querySelector('footer.footer-area');
    if (legacyFooter) {
      const fhost = document.createElement('div');
      fhost.id = 'bmn-footer-host';
      legacyFooter.replaceWith(fhost);
    }

    await window.BMNLayout.mountPublicLayout({
      active: fileName.startsWith('R-') ? 'relationship' : 'wwyd',
    });

    const { article } = await window.BMNContent.fetchArticleBySlugOrPath(slug);
    if (!article) return;

    // Sync live CMS edits (title, cover, prose) into existing page
    document.title = `${article.title} — Bɔ-Me-Nkɔmmɔ`;
    const topTitle = document.querySelector('.top-left h1');
    if (topTitle) topTitle.textContent = article.title;
    const innerTitle = document.querySelector('.top-wrapper h1, .top-wrapper h2');
    if (innerTitle) innerTitle.textContent = article.title;

    const coverImg = document.querySelector('.single-page-post > img');
    if (coverImg && article.cover_image_url) {
      coverImg.src = mediaUrl(article.cover_image_url, '/img/frontpik2.jpg');
      coverImg.alt = article.title;
    }

    const contentDiv = document.querySelector('.single-post-content');
    if (contentDiv && Array.isArray(article.paragraphs) && article.paragraphs.length) {
      contentDiv.innerHTML =
        article.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('') +
        `<p1><b>-${escapeHtml(article.author_pen_name)}</b></p1>`;
    }

    await window.BMNContent.incrementView(article.slug);

    // Mount live Like, Share & Comments widget inside .single-page-post
    const postCard = document.querySelector('.single-page-post');
    if (!postCard) return;

    const widget = document.createElement('div');
    widget.className = 'bmn-legacy-engagement';
    widget.style.marginTop = '32px';
    widget.innerHTML = `
      <div class="bmn-engagement-bar" style="margin:24px 0;padding:18px 0;">
        <button type="button" class="bmn-btn bmn-btn-secondary" id="legacy-like-btn">
          <i class="fa fa-heart-o" aria-hidden="true"></i>
          <span>Appreciate Story</span>
          <strong id="legacy-like-count">${Number(article.likes_count || 0)}</strong>
        </button>
        <a href="/submit-story.html" class="bmn-btn bmn-btn-primary">Share Your Story</a>
      </div>
      <div style="margin-top:28px;">
        <h3 style="font-family:var(--bmn-font-display);font-size:22px;margin-bottom:8px;">Reader Advice &amp; Comments</h3>
        <p style="font-size:14px;color:#4b5563;margin-bottom:18px;">Comments appear after editorial review.</p>
        <div id="legacy-comments-list" style="margin-bottom:24px;"></div>
        <form id="legacy-comment-form" style="background:#faf9f6;border:1px solid rgba(17,24,39,0.1);border-radius:10px;padding:20px;">
          <div id="legacy-comment-feedback"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="bmn-field">
              <label for="legacy-c-name">Your Name</label>
              <input id="legacy-c-name" class="bmn-input" required minlength="2" maxlength="100" placeholder="Your name">
            </div>
            <div class="bmn-field">
              <label for="legacy-c-email">Email (optional, private)</label>
              <input id="legacy-c-email" type="email" class="bmn-input" maxlength="180" placeholder="you@example.com">
            </div>
          </div>
          <div class="bmn-field">
            <label for="legacy-c-body">Your Advice or Comment</label>
            <textarea id="legacy-c-body" class="bmn-textarea" required minlength="3" maxlength="3000" placeholder="Share your thoughts..."></textarea>
          </div>
          <button type="submit" class="bmn-btn bmn-btn-primary" id="legacy-c-submit">Post Comment</button>
        </form>
      </div>
    `;
    postCard.appendChild(widget);

    const likeKey = `bmn_liked_${article.slug}`;
    const likeBtn = document.getElementById('legacy-like-btn');
    const likeCount = document.getElementById('legacy-like-count');
    if (sessionStorage.getItem(likeKey)) {
      likeBtn.querySelector('i').className = 'fa fa-heart';
    }
    likeBtn.addEventListener('click', async () => {
      if (sessionStorage.getItem(likeKey)) return;
      sessionStorage.setItem(likeKey, '1');
      likeBtn.querySelector('i').className = 'fa fa-heart';
      const next = await window.BMNContent.incrementLike(article.slug);
      likeCount.textContent = String(typeof next === 'number' && next > 0 ? next : Number(likeCount.textContent) + 1);
    });

    const comments = await window.BMNContent.fetchApprovedComments(article.id);
    const listEl = document.getElementById('legacy-comments-list');
    listEl.innerHTML = comments.length
      ? comments
          .map(
            (c) => `
          <div class="bmn-comment-card">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <strong>${escapeHtml(c.author_name)}</strong>
              <span style="font-size:12px;color:#6b7280;">${escapeHtml(window.BMNSupabase.formatDate(c.created_at))}</span>
            </div>
            <p style="margin:0;font-size:14px;color:#4b5563;">${escapeHtml(c.body)}</p>
          </div>
        `
          )
          .join('')
      : '<p style="font-size:14px;color:#6b7280;">No comments published yet.</p>';

    document.getElementById('legacy-comment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fb = document.getElementById('legacy-comment-feedback');
      const btn = document.getElementById('legacy-c-submit');
      btn.disabled = true;
      btn.textContent = 'Submitting...';
      fb.innerHTML = '';
      try {
        await window.BMNContent.submitComment({
          articleId: article.id,
          authorName: document.getElementById('legacy-c-name').value,
          authorEmail: document.getElementById('legacy-c-email').value,
          body: document.getElementById('legacy-c-body').value,
        });
        fb.innerHTML = '<div class="bmn-alert bmn-alert-success">Comment submitted for editorial review.</div>';
        e.target.reset();
      } catch (err) {
        fb.innerHTML = `<div class="bmn-alert bmn-alert-error">${escapeHtml(err.message)}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Post Comment';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLegacyStoryBridge);
  } else {
    initLegacyStoryBridge();
  }
})();
