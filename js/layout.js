// Shared public header, announcement banner, and footer renderer
(function () {
  async function mountPublicLayout(options = {}) {
    const { escapeHtml, safeUrl } = window.BMNSupabase;
    const activePage = options.active || '';
    const [{ pages }, { items: announcements }] = await Promise.all([
      window.BMNContent.fetchSitePages(),
      window.BMNContent.fetchAnnouncements(),
    ]);

    const settings = pages.site_settings || {};
    const banner = announcements.find((a) => a.kind === 'site_banner' && a.is_active);

    const bannerHost = document.getElementById('bmn-announcement-host');
    if (bannerHost) {
      if (banner) {
        bannerHost.innerHTML = `
          <div class="bmn-announcement-bar" role="region" aria-label="Announcement">
            <div class="bmn-announcement-inner">
              <span><strong>${escapeHtml(banner.title)}</strong>${banner.summary ? ' — ' + escapeHtml(banner.summary) : ''}</span>
              ${banner.cta_url ? `<a class="bmn-announcement-link" href="${escapeHtml(safeUrl(banner.cta_url, '/stories.html'))}">${escapeHtml(banner.cta_label || 'Read more')}</a>` : ''}
            </div>
          </div>
        `;
      } else {
        bannerHost.innerHTML = '';
      }
    }

    const headerHost = document.getElementById('bmn-header-host');
    if (headerHost) {
      const navLinks = [
        { key: 'home', label: 'Home', href: '/index.html' },
        { key: 'relationship', label: 'Relationship', href: '/stories.html?category=relationship' },
        { key: 'wwyd', label: 'What Will You Do?', href: '/stories.html?category=what-will-you-do' },
        { key: 'stories', label: 'All Stories', href: '/stories.html' },
        { key: 'about', label: 'About', href: '/index.html#about' },
      ];

      headerHost.innerHTML = `
        <header class="bmn-header">
          <div class="bmn-header-inner">
            <a class="bmn-brand" href="/index.html">
              <img src="/img/trylogo2.png" alt="Bɔ-Me-Nkɔmmɔ">
              <span>Bɔ-Me-Nkɔmmɔ</span>
            </a>

            <nav class="bmn-nav" aria-label="Primary Navigation">
              ${navLinks
                .map(
                  (l) =>
                    `<a href="${l.href}" class="${activePage === l.key ? 'is-active' : ''}">${escapeHtml(l.label)}</a>`
                )
                .join('')}
            </nav>

            <div class="bmn-header-actions">
              <a href="/submit-story.html" class="bmn-btn bmn-btn-primary">Share Your Story</a>
            </div>

            <button type="button" class="bmn-mobile-toggle" id="bmn-mobile-toggle" aria-expanded="false" aria-controls="bmn-mobile-drawer" aria-label="Toggle navigation menu">
              <i class="fa fa-bars" aria-hidden="true"></i>
            </button>
          </div>
          <div class="bmn-mobile-drawer" id="bmn-mobile-drawer">
            ${navLinks.map((l) => `<a href="${l.href}">${escapeHtml(l.label)}</a>`).join('')}
            <a href="/submit-story.html" class="bmn-btn bmn-btn-primary" style="margin-top:8px;">Share Your Story</a>
            <a href="/admin/login.html" style="color:#4b5563;font-size:13px;">Admin Portal</a>
          </div>
        </header>
      `;

      const toggleBtn = document.getElementById('bmn-mobile-toggle');
      const drawer = document.getElementById('bmn-mobile-drawer');
      if (toggleBtn && drawer) {
        toggleBtn.addEventListener('click', () => {
          const open = drawer.classList.toggle('is-open');
          toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
      }
    }

    const footerHost = document.getElementById('bmn-footer-host');
    if (footerHost) {
      const pubTitle = settings.publicationTitle || 'Bɔ-Me-Nkɔmmɔ';
      const pubSub = settings.publicationSubtitle || 'Enjoy Real life Relationship experiences';
      const fbUrl = safeUrl(settings.facebookUrl || 'https://web.facebook.com/profile.php?id=61560775524170');
      const year = new Date().getFullYear();

      footerHost.innerHTML = `
        <footer class="bmn-footer">
          <div class="bmn-container">
            <div class="bmn-footer-grid">
              <div>
                <h4>${escapeHtml(pubTitle)}</h4>
                <p style="margin:0 0 16px;max-width:42ch;line-height:1.65;">${escapeHtml(pubSub)}. Real stories, candid relationship dilemmas, and thoughtful advice from our community.</p>
                <div style="display:flex;gap:14px;align-items:center;">
                  <a href="${escapeHtml(fbUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Facebook"><i class="fa fa-facebook" aria-hidden="true"></i></a>
                  ${settings.twitterUrl && settings.twitterUrl !== '#' ? `<a href="${escapeHtml(safeUrl(settings.twitterUrl))}" target="_blank" rel="noopener noreferrer" aria-label="Twitter"><i class="fa fa-twitter" aria-hidden="true"></i></a>` : ''}
                  ${settings.instagramUrl && settings.instagramUrl !== '#' ? `<a href="${escapeHtml(safeUrl(settings.instagramUrl))}" target="_blank" rel="noopener noreferrer" aria-label="Instagram"><i class="fa fa-instagram" aria-hidden="true"></i></a>` : ''}
                  ${settings.youtubeUrl && settings.youtubeUrl !== '#' ? `<a href="${escapeHtml(safeUrl(settings.youtubeUrl))}" target="_blank" rel="noopener noreferrer" aria-label="YouTube"><i class="fa fa-youtube" aria-hidden="true"></i></a>` : ''}
                </div>
              </div>
              <div>
                <h4>Sections</h4>
                <ul>
                  <li><a href="/index.html">Home</a></li>
                  <li><a href="/stories.html?category=relationship">Relationship Stories</a></li>
                  <li><a href="/stories.html?category=what-will-you-do">What Will You Do?</a></li>
                  <li><a href="/stories.html">Explore Archive</a></li>
                </ul>
              </div>
              <div>
                <h4>Community &amp; Editorial</h4>
                <ul>
                  <li><a href="/submit-story.html">Share Your Story</a></li>
                  <li><a href="/submit-story.html?type=enquiry">Contact Editorial Team</a></li>
                  <li><a href="/index.html#about">About Us</a></li>
                  <li><a href="/admin/login.html">Admin Portal</a></li>
                </ul>
              </div>
            </div>
            <div class="bmn-footer-bottom">
              <span>&copy; ${year} ${escapeHtml(pubTitle)}. All rights reserved.</span>
              <span>Editorial Platform &amp; Community Storytelling</span>
            </div>
          </div>
        </footer>
      `;
    }

    return { pages, announcements };
  }

  window.BMNLayout = { mountPublicLayout };
})();
