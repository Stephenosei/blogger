// Complete RBAC Admin Portal backed by Supabase Auth, PostgreSQL, RLS, Storage & Edge Functions
(async function () {
  const { escapeHtml, mediaUrl, slugify, formatDate } = window.BMNSupabase;
  const { client, configured } = await window.BMNSupabase.getSupabase();

  const gateEl = document.getElementById('adm-gate');
  const gateCard = document.getElementById('adm-gate-card');
  const appEl = document.getElementById('adm-app');

  if (!configured) {
    gateCard.innerHTML = `
      <h2 style="margin:0 0 10px;font-size:18px;">Supabase Configuration Required</h2>
      <p style="margin:0 0 16px;color:#475569;">Set <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> in your environment secrets and run the SQL migrations in <code>supabase/migrations/</code>.</p>
      <a href="/admin/login.html" class="adm-btn adm-btn-primary">Go to Sign In</a>
      <a href="/index.html" class="adm-btn adm-btn-secondary" style="margin-left:8px;">Public Site</a>
    `;
    return;
  }

  const { data: sessionRes } = await client.auth.getSession();
  const session = sessionRes?.session;
  if (!session) {
    window.location.replace('/admin/login.html');
    return;
  }

  // Load caller profile & RBAC role
  const { data: profile, error: profErr } = await client
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle();

  if (profErr || !profile) {
    gateCard.innerHTML = `
      <h2 style="margin:0 0 10px;font-size:18px;">Profile Not Initialized</h2>
      <p style="margin:0 0 16px;color:#475569;">${escapeHtml(profErr?.message || 'Your staff profile row was not found. Ensure 001_core_rbac_and_profiles.sql has been applied.')}</p>
      <button type="button" id="gate-logout" class="adm-btn adm-btn-secondary">Sign Out</button>
    `;
    document.getElementById('gate-logout').addEventListener('click', async () => {
      await client.auth.signOut();
      window.location.replace('/admin/login.html');
    });
    return;
  }

  if (!profile.is_active) {
    gateCard.innerHTML = `
      <h2 style="margin:0 0 10px;font-size:18px;">Activation Pending</h2>
      <p style="margin:0 0 16px;color:#475569;">Signed in as <strong>${escapeHtml(profile.email)}</strong> (${escapeHtml(profile.role)}). A Super Administrator must activate your account before you can access the Admin Portal.</p>
      <div style="display:flex;gap:8px;">
        <button type="button" id="gate-logout" class="adm-btn adm-btn-secondary">Sign Out</button>
        <a href="/index.html" class="adm-btn adm-btn-primary">Return to Public Site</a>
      </div>
    `;
    document.getElementById('gate-logout').addEventListener('click', async () => {
      await client.auth.signOut();
      window.location.replace('/admin/login.html');
    });
    return;
  }

  // Authenticated & active staff
  gateEl.style.display = 'none';
  appEl.style.display = 'grid';

  const roleLabels = {
    super_admin: 'Super Administrator',
    content_admin: 'Content Administrator',
    editor: 'Editor',
  };

  const state = {
    profile,
    role: profile.role,
    section: 'overview',
    articles: [],
    categories: [],
    tags: [],
    announcements: [],
    media: [],
    submissions: [],
    comments: [],
    tasks: [],
    pages: [],
    team: [],
    logs: [],
    notifications: [],
  };

  const isSuperAdmin = () => state.role === 'super_admin';
  const isContentOrSuper = () => state.role === 'super_admin' || state.role === 'content_admin';

  document.getElementById('adm-user-name').textContent = profile.full_name || profile.email;
  document.getElementById('adm-role-label').textContent = `${roleLabels[state.role] || state.role} · ${profile.email}`;

  // Navigation Definition (RBAC-filtered)
  const navGroups = [
    {
      label: 'Editorial',
      items: [
        { id: 'overview', label: 'Overview', icon: 'fa-th-large', roles: ['super_admin', 'content_admin', 'editor'] },
        { id: 'articles', label: 'Articles (CMS)', icon: 'fa-file-text-o', roles: ['super_admin', 'content_admin', 'editor'] },
        { id: 'taxonomies', label: 'Categories & Tags', icon: 'fa-tags', roles: ['super_admin', 'content_admin'] },
        { id: 'announcements', label: 'Upcoming & Banners', icon: 'fa-bullhorn', roles: ['super_admin', 'content_admin'] },
        { id: 'media', label: 'Media Library', icon: 'fa-picture-o', roles: ['super_admin', 'content_admin', 'editor'] },
      ],
    },
    {
      label: 'Community & Workflow',
      items: [
        { id: 'submissions', label: 'Reader Submissions', icon: 'fa-inbox', roles: ['super_admin', 'content_admin', 'editor'], badgeKey: 'newSubmissions' },
        { id: 'comments', label: 'Comments Moderation', icon: 'fa-comments-o', roles: ['super_admin', 'content_admin'], badgeKey: 'pendingComments' },
        { id: 'tasks', label: 'Editorial Tasks', icon: 'fa-check-square-o', roles: ['super_admin', 'content_admin', 'editor'], badgeKey: 'openTasks' },
      ],
    },
    {
      label: 'Administration',
      items: [
        { id: 'pages', label: 'Pages & Settings', icon: 'fa-sliders', roles: ['super_admin', 'content_admin'] },
        { id: 'team', label: 'Team & Roles', icon: 'fa-users', roles: ['super_admin'] },
        { id: 'logs', label: 'Activity Logs', icon: 'fa-history', roles: ['super_admin', 'content_admin'] },
      ],
    },
  ];

  function renderNav() {
    const counts = {
      newSubmissions: state.submissions.filter((s) => s.status === 'new').length,
      pendingComments: state.comments.filter((c) => c.status === 'pending').length,
      openTasks: state.tasks.filter((t) => t.status !== 'done').length,
    };

    const navEl = document.getElementById('adm-nav');
    navEl.innerHTML = navGroups
      .map((g) => {
        const visible = g.items.filter((i) => i.roles.includes(state.role));
        if (!visible.length) return '';
        return `
          <div class="adm-nav-group">
            <div class="adm-nav-label">${escapeHtml(g.label)}</div>
            ${visible
              .map((i) => {
                const badge = i.badgeKey && counts[i.badgeKey] > 0 ? `<span class="adm-count">${counts[i.badgeKey]}</span>` : '';
                return `
                  <button type="button" class="adm-nav-item ${state.section === i.id ? 'is-active' : ''}" data-section="${i.id}">
                    <span class="adm-nav-left"><i class="fa ${i.icon}" aria-hidden="true"></i> ${escapeHtml(i.label)}</span>
                    ${badge}
                  </button>
                `;
              })
              .join('')}
          </div>
        `;
      })
      .join('');
  }

  // Modal helpers
  const modalBackdrop = document.getElementById('adm-modal-backdrop');
  const modalTitle = document.getElementById('adm-modal-title');
  const modalBody = document.getElementById('adm-modal-body');

  function openModal(title, html) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modalBackdrop.classList.add('is-open');
  }
  function closeModal() {
    modalBackdrop.classList.remove('is-open');
    modalBody.innerHTML = '';
  }
  document.getElementById('adm-modal-close').addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeModal();
  });

  // Mobile sidebar
  document.getElementById('adm-mobile-btn').addEventListener('click', () => {
    document.getElementById('adm-sidebar').classList.toggle('is-open');
  });

  // Sign out
  document.getElementById('adm-logout-btn').addEventListener('click', async () => {
    await client.auth.signOut();
    window.location.replace('/admin/login.html');
  });

  // Notifications
  async function loadNotifications() {
    const { data } = await client
      .from('admin_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(25);
    state.notifications = data || [];
    const unread = state.notifications.filter((n) => !n.is_read).length;
    const badge = document.getElementById('adm-notif-badge');
    badge.style.display = unread > 0 ? 'inline-flex' : 'none';
    badge.textContent = String(unread);

    const listEl = document.getElementById('adm-notif-list');
    if (!state.notifications.length) {
      listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b;">No notifications yet.</div>';
      return;
    }
    listEl.innerHTML = state.notifications
      .map(
        (n) => `
      <div data-notif-id="${escapeHtml(n.id)}" data-link-section="${escapeHtml(n.link_section || 'overview')}" style="padding:12px 14px;border-bottom:1px solid #f1f5f9;cursor:pointer;background:${n.is_read ? '#fff' : '#eff6ff'};">
        <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:2px;">
          <strong style="font-size:13px;">${escapeHtml(n.title)}</strong>
          <span style="font-size:11px;color:#64748b;">${escapeHtml(formatDate(n.created_at))}</span>
        </div>
        <div style="font-size:12.5px;color:#475569;">${escapeHtml(n.message)}</div>
      </div>
    `
      )
      .join('');
  }

  const notifBtn = document.getElementById('adm-notif-btn');
  const notifPanel = document.getElementById('adm-notif-panel');
  notifBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    notifPanel.classList.toggle('is-open');
  });
  document.addEventListener('click', (e) => {
    if (!notifPanel.contains(e.target) && e.target !== notifBtn) {
      notifPanel.classList.remove('is-open');
    }
  });
  notifPanel.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-notif-id]');
    if (!item) return;
    await client.from('admin_notifications').update({ is_read: true }).eq('id', item.dataset.notifId);
    notifPanel.classList.remove('is-open');
    await loadNotifications();
    switchSection(item.dataset.linkSection || 'overview');
  });
  document.getElementById('adm-mark-all-read').addEventListener('click', async () => {
    const unreadIds = state.notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length) {
      await client.from('admin_notifications').update({ is_read: true }).in('id', unreadIds);
      await loadNotifications();
    }
  });

  // Profile modal
  document.getElementById('adm-profile-btn').addEventListener('click', () => {
    openModal(
      'My Profile & Security',
      `
      <div id="prof-fb"></div>
      <form id="prof-form">
        <div class="adm-field">
          <label>Email</label>
          <input class="adm-input" value="${escapeHtml(state.profile.email)}" disabled>
        </div>
        <div class="adm-field">
          <label>Assigned Role</label>
          <input class="adm-input" value="${escapeHtml(roleLabels[state.role] || state.role)}" disabled>
        </div>
        <div class="adm-field">
          <label for="prof-name">Display Name</label>
          <input id="prof-name" class="adm-input" required value="${escapeHtml(state.profile.full_name || '')}">
        </div>
        <button type="submit" class="adm-btn adm-btn-primary">Save Name</button>
      </form>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
      <form id="pw-form">
        <div class="adm-field">
          <label for="prof-pw">Change Password (min 8 chars)</label>
          <input id="prof-pw" type="password" class="adm-input" required minlength="8" placeholder="New password">
        </div>
        <button type="submit" class="adm-btn adm-btn-secondary">Update Password</button>
      </form>
    `
    );

    document.getElementById('prof-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = document.getElementById('prof-name').value.trim();
      const { error } = await client.from('profiles').update({ full_name: fullName }).eq('id', state.profile.id);
      const fb = document.getElementById('prof-fb');
      if (error) {
        fb.innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(error.message)}</div>`;
      } else {
        state.profile.full_name = fullName;
        document.getElementById('adm-user-name').textContent = fullName;
        fb.innerHTML = '<div class="adm-alert adm-alert-success">Profile updated.</div>';
      }
    });

    document.getElementById('pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = document.getElementById('prof-pw').value;
      const { error } = await client.auth.updateUser({ password: pw });
      const fb = document.getElementById('prof-fb');
      if (error) {
        fb.innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(error.message)}</div>`;
      } else {
        fb.innerHTML = '<div class="adm-alert adm-alert-success">Password changed successfully.</div>';
        e.target.reset();
      }
    });
  });

  // Load initial data in parallel
  async function refreshCoreData() {
    const queries = [
      client.from('articles').select('*, categories(name, slug), article_tags(tag_id)').order('updated_at', { ascending: false }),
      client.from('categories').select('*').order('sort_order', { ascending: true }),
      client.from('tags').select('*').order('name', { ascending: true }),
      client.from('announcements').select('*').order('display_order', { ascending: true }),
      client.from('media_assets').select('*').order('created_at', { ascending: false }),
      client.from('reader_submissions').select('*').order('created_at', { ascending: false }),
      client.from('editorial_tasks').select('*').order('created_at', { ascending: false }),
      client.from('site_pages').select('*').order('slug', { ascending: true }),
      client.from('profiles').select('id, email, full_name, role, is_active, created_at').order('created_at', { ascending: true }),
    ];

    if (isContentOrSuper()) {
      queries.push(client.from('article_comments').select('*, articles(title)').order('created_at', { ascending: false }));
      queries.push(client.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(100));
    }

    const results = await Promise.all(queries);
    state.articles = results[0].data || [];
    state.categories = results[1].data || [];
    state.tags = results[2].data || [];
    state.announcements = results[3].data || [];
    state.media = results[4].data || [];
    state.submissions = results[5].data || [];
    state.tasks = results[6].data || [];
    state.pages = results[7].data || [];
    state.team = results[8].data || [];
    if (isContentOrSuper()) {
      state.comments = results[9]?.data || [];
      state.logs = results[10]?.data || [];
    }
    await loadNotifications();
    renderNav();
  }

  function switchSection(sectionId) {
    state.section = sectionId;
    document.getElementById('adm-sidebar').classList.remove('is-open');
    const allItems = navGroups.flatMap((g) => g.items);
    const meta = allItems.find((i) => i.id === sectionId);
    document.getElementById('adm-page-title').textContent = meta ? meta.label : 'Overview';
    renderNav();
    renderCurrentSection();
  }

  document.getElementById('adm-nav').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-section]');
    if (btn) switchSection(btn.dataset.section);
  });

  // Renderers per section
  function renderCurrentSection() {
    const view = document.getElementById('adm-view');
    switch (state.section) {
      case 'overview': return renderOverview(view);
      case 'articles': return renderArticles(view);
      case 'taxonomies': return renderTaxonomies(view);
      case 'announcements': return renderAnnouncements(view);
      case 'media': return renderMedia(view);
      case 'submissions': return renderSubmissions(view);
      case 'comments': return renderComments(view);
      case 'tasks': return renderTasks(view);
      case 'pages': return renderPages(view);
      case 'team': return renderTeam(view);
      case 'logs': return renderLogs(view);
      default: return renderOverview(view);
    }
  }

  function renderOverview(view) {
    const publishedCount = state.articles.filter((a) => a.status === 'published').length;
    const draftCount = state.articles.filter((a) => a.status === 'draft' || a.status === 'in_review').length;
    const totalReads = state.articles.reduce((sum, a) => sum + Number(a.views_count || 0), 0);
    const totalLikes = state.articles.reduce((sum, a) => sum + Number(a.likes_count || 0), 0);
    const newSubs = state.submissions.filter((s) => s.status === 'new').length;
    const pendingComments = state.comments.filter((c) => c.status === 'pending').length;
    const openTasks = state.tasks.filter((t) => t.status !== 'done').length;

    view.innerHTML = `
      <div class="adm-stats-grid">
        <div class="adm-stat-card">
          <div class="adm-stat-label">Published Stories</div>
          <div class="adm-stat-value">${publishedCount}</div>
          <div class="adm-stat-sub">${draftCount} in draft / review</div>
        </div>
        <div class="adm-stat-card">
          <div class="adm-stat-label">Reader Engagement</div>
          <div class="adm-stat-value">${totalReads}</div>
          <div class="adm-stat-sub">${totalLikes} story appreciations</div>
        </div>
        <div class="adm-stat-card">
          <div class="adm-stat-label">New Submissions</div>
          <div class="adm-stat-value">${newSubs}</div>
          <div class="adm-stat-sub">${state.submissions.length} total reader entries</div>
        </div>
        <div class="adm-stat-card">
          <div class="adm-stat-label">Open Editorial Tasks</div>
          <div class="adm-stat-value">${openTasks}</div>
          <div class="adm-stat-sub">${isContentOrSuper() ? `${pendingComments} comments pending review` : 'Assigned workflow queue'}</div>
        </div>
      </div>

      <div class="adm-grid-2">
        <div class="adm-card">
          <div class="adm-card-head">
            <h2 class="adm-card-title">Recent Reader Submissions</h2>
            <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="ov-go-subs">Open Queue</button>
          </div>
          ${
            state.submissions.length
              ? `<div class="adm-table-wrap"><table class="adm-table">
                  <thead><tr><th>Title</th><th>Sender</th><th>Status</th></tr></thead>
                  <tbody>
                    ${state.submissions
                      .slice(0, 5)
                      .map(
                        (s) => `<tr>
                          <td><strong>${escapeHtml(s.title)}</strong></td>
                          <td>${escapeHtml(s.sender_name)}</td>
                          <td><span class="adm-status adm-status-${escapeHtml(s.status)}">${escapeHtml(s.status)}</span></td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table></div>`
              : '<p style="color:#64748b;margin:0;">No reader submissions yet.</p>'
          }
        </div>

        <div class="adm-card">
          <div class="adm-card-head">
            <h2 class="adm-card-title">Recent Articles</h2>
            <button type="button" class="adm-btn adm-btn-primary adm-btn-sm" id="ov-new-art">+ New Article</button>
          </div>
          <div class="adm-table-wrap"><table class="adm-table">
            <thead><tr><th>Title</th><th>Category</th><th>Status</th></tr></thead>
            <tbody>
              ${state.articles
                .slice(0, 5)
                .map(
                  (a) => `<tr>
                    <td><strong>${escapeHtml(a.title)}</strong></td>
                    <td>${escapeHtml(a.categories?.name || '')}</td>
                    <td><span class="adm-status adm-status-${escapeHtml(a.status)}">${escapeHtml(a.status)}</span></td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table></div>
        </div>
      </div>
    `;

    document.getElementById('ov-go-subs')?.addEventListener('click', () => switchSection('submissions'));
    document.getElementById('ov-new-art')?.addEventListener('click', () => openArticleEditor(null));
  }

  // Articles CMS
  function renderArticles(view) {
    view.innerHTML = `
      <div class="adm-card">
        <div class="adm-card-head">
          <div style="display:flex;gap:10px;flex-wrap:wrap;flex:1;">
            <input type="search" id="art-search" class="adm-input" style="max-width:260px;" placeholder="Filter articles...">
            <select id="art-status-filter" class="adm-select" style="max-width:160px;">
              <option value="all">All Statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="in_review">In Review</option>
              <option value="archived">Archived</option>
            </select>
            <select id="art-cat-filter" class="adm-select" style="max-width:190px;">
              <option value="all">All Categories</option>
              ${state.categories.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <button type="button" class="adm-btn adm-btn-primary" id="btn-new-article">+ Create Article</button>
        </div>
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Author</th>
                <th>Status</th>
                <th class="adm-num">Views</th>
                <th class="adm-num">Likes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="art-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    const drawRows = () => {
      const q = document.getElementById('art-search').value.trim().toLowerCase();
      const st = document.getElementById('art-status-filter').value;
      const cat = document.getElementById('art-cat-filter').value;

      const list = state.articles.filter((a) => {
        if (st !== 'all' && a.status !== st) return false;
        if (cat !== 'all' && a.category_id !== cat) return false;
        if (q && !`${a.title} ${a.author_pen_name} ${a.slug}`.toLowerCase().includes(q)) return false;
        return true;
      });

      const tbody = document.getElementById('art-tbody');
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:24px;">No articles match the current filters.</td></tr>';
        return;
      }

      tbody.innerHTML = list
        .map((a) => {
          const canEdit = isContentOrSuper() || (a.author_id === state.profile.id && (a.status === 'draft' || a.status === 'in_review'));
          return `
            <tr>
              <td>
                <strong>${escapeHtml(a.title)}</strong>
                <div style="font-size:12px;color:#64748b;">/${escapeHtml(a.slug)}${a.is_featured ? ' · Featured' : ''}</div>
              </td>
              <td>${escapeHtml(a.categories?.name || '')}</td>
              <td>${escapeHtml(a.author_pen_name)}</td>
              <td><span class="adm-status adm-status-${escapeHtml(a.status)}">${escapeHtml(a.status)}</span></td>
              <td class="adm-num">${Number(a.views_count || 0)}</td>
              <td class="adm-num">${Number(a.likes_count || 0)}</td>
              <td style="white-space:nowrap;">
                ${a.status === 'published' ? `<a href="/story.html?slug=${encodeURIComponent(a.slug)}" target="_blank" class="adm-btn adm-btn-secondary adm-btn-sm">View</a>` : ''}
                ${canEdit ? `<button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-edit-art="${escapeHtml(a.id)}">Edit</button>` : ''}
                ${
                  isContentOrSuper()
                    ? `<button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-toggle-pub="${escapeHtml(a.id)}">${a.status === 'published' ? 'Unpublish' : 'Publish'}</button>
                       <button type="button" class="adm-btn adm-btn-danger adm-btn-sm" data-del-art="${escapeHtml(a.id)}">Delete</button>`
                    : ''
                }
              </td>
            </tr>
          `;
        })
        .join('');
    };

    document.getElementById('art-search').addEventListener('input', drawRows);
    document.getElementById('art-status-filter').addEventListener('change', drawRows);
    document.getElementById('art-cat-filter').addEventListener('change', drawRows);
    document.getElementById('btn-new-article').addEventListener('click', () => openArticleEditor(null));

    document.getElementById('art-tbody').addEventListener('click', async (e) => {
      const editBtn = e.target.closest('[data-edit-art]');
      if (editBtn) {
        const art = state.articles.find((a) => a.id === editBtn.dataset.editArt);
        if (art) openArticleEditor(art);
        return;
      }
      const pubBtn = e.target.closest('[data-toggle-pub]');
      if (pubBtn) {
        const art = state.articles.find((a) => a.id === pubBtn.dataset.togglePub);
        if (!art) return;
        const nextStatus = art.status === 'published' ? 'draft' : 'published';
        const { error } = await client
          .from('articles')
          .update({
            status: nextStatus,
            published_at: nextStatus === 'published' ? art.published_at || new Date().toISOString() : art.published_at,
            updated_by: state.profile.id,
          })
          .eq('id', art.id);
        if (!error) {
          await refreshCoreData();
          renderArticles(view);
        }
        return;
      }
      const delBtn = e.target.closest('[data-del-art]');
      if (delBtn) {
        const art = state.articles.find((a) => a.id === delBtn.dataset.delArt);
        if (!art) return;
        openModal(
          'Confirm Article Deletion',
          `<p>Delete <strong>${escapeHtml(art.title)}</strong> permanently?</p>
           <div style="display:flex;gap:10px;justify-content:flex-end;">
             <button type="button" class="adm-btn adm-btn-secondary" id="cancel-del">Cancel</button>
             <button type="button" class="adm-btn adm-btn-danger" id="confirm-del">Delete Article</button>
           </div>`
        );
        document.getElementById('cancel-del').addEventListener('click', closeModal);
        document.getElementById('confirm-del').addEventListener('click', async () => {
          await client.from('articles').delete().eq('id', art.id);
          closeModal();
          await refreshCoreData();
          renderArticles(view);
        });
      }
    });

    drawRows();
  }

  function openArticleEditor(existing, prefill = null) {
    const art = existing || prefill || {
      title: '',
      slug: '',
      category_id: state.categories[0]?.id || '',
      author_pen_name: state.profile.full_name || 'Editorial Team',
      cover_image_url: 'img/frontpik2.jpg',
      thumbnail_url: 'img/frontpik2.jpg',
      excerpt: '',
      content_paragraphs: [],
      status: 'draft',
      is_featured: false,
      display_date_label: formatDate(new Date().toISOString()),
      article_tags: [],
    };
    const selectedTagIds = new Set((art.article_tags || []).map((t) => t.tag_id));
    const paragraphsText = Array.isArray(art.content_paragraphs) ? art.content_paragraphs.join('\n\n') : '';
    const allowedStatuses = isContentOrSuper()
      ? ['draft', 'in_review', 'published', 'archived']
      : ['draft', 'in_review'];

    openModal(
      existing ? 'Edit Article' : 'Create Article',
      `
      <div id="art-form-fb"></div>
      <form id="art-editor-form">
        <div class="adm-grid-2">
          <div class="adm-field">
            <label for="ed-title">Title</label>
            <input id="ed-title" class="adm-input" required minlength="3" maxlength="220" value="${escapeHtml(art.title)}">
          </div>
          <div class="adm-field">
            <label for="ed-slug">URL Slug</label>
            <input id="ed-slug" class="adm-input" required pattern="[a-z0-9-]+" value="${escapeHtml(art.slug)}">
          </div>
        </div>
        <div class="adm-grid-2">
          <div class="adm-field">
            <label for="ed-cat">Category</label>
            <select id="ed-cat" class="adm-select" required>
              ${state.categories
                .map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === art.category_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="adm-field">
            <label for="ed-pen">Author Pen Name</label>
            <input id="ed-pen" class="adm-input" required value="${escapeHtml(art.author_pen_name)}">
          </div>
        </div>
        <div class="adm-grid-2">
          <div class="adm-field">
            <label for="ed-cover">Cover Image URL</label>
            <input id="ed-cover" class="adm-input" value="${escapeHtml(art.cover_image_url)}" list="media-url-list">
          </div>
          <div class="adm-field">
            <label for="ed-thumb">Thumbnail Image URL</label>
            <input id="ed-thumb" class="adm-input" value="${escapeHtml(art.thumbnail_url)}" list="media-url-list">
          </div>
        </div>
        <datalist id="media-url-list">
          ${state.media.map((m) => `<option value="${escapeHtml(m.public_url)}">${escapeHtml(m.file_name)}</option>`).join('')}
        </datalist>
        <div class="adm-grid-2">
          <div class="adm-field">
            <label for="ed-status">Status</label>
            <select id="ed-status" class="adm-select">
              ${allowedStatuses.map((s) => `<option value="${s}" ${art.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="adm-field">
            <label for="ed-date-label">Display Date Label</label>
            <input id="ed-date-label" class="adm-input" value="${escapeHtml(art.display_date_label || '')}" placeholder="e.g. 20 Dec 2024">
          </div>
        </div>
        <div class="adm-field">
          <label>Tags</label>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            ${state.tags
              .map(
                (t) => `<label style="display:inline-flex;align-items:center;gap:5px;font-weight:400;margin:0;">
                  <input type="checkbox" name="ed-tags" value="${escapeHtml(t.id)}" ${selectedTagIds.has(t.id) ? 'checked' : ''}>
                  ${escapeHtml(t.name)}
                </label>`
              )
              .join('')}
          </div>
        </div>
        <div class="adm-field">
          <label for="ed-excerpt">Summary / Excerpt</label>
          <textarea id="ed-excerpt" class="adm-textarea" style="min-height:70px;">${escapeHtml(art.excerpt)}</textarea>
        </div>
        <div class="adm-field">
          <label for="ed-body">Story Paragraphs (separate paragraphs with a blank line)</label>
          <textarea id="ed-body" class="adm-textarea" style="min-height:220px;" required>${escapeHtml(paragraphsText)}</textarea>
        </div>
        ${
          isContentOrSuper()
            ? `<div class="adm-field" style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="ed-featured" ${art.is_featured ? 'checked' : ''}>
                <label for="ed-featured" style="margin:0;">Feature this story prominently on the homepage</label>
              </div>`
            : ''
        }
        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button type="button" class="adm-btn adm-btn-secondary" id="ed-cancel">Cancel</button>
          <button type="submit" class="adm-btn adm-btn-primary" id="ed-save">Save Article</button>
        </div>
      </form>
    `
    );

    const titleEl = document.getElementById('ed-title');
    const slugEl = document.getElementById('ed-slug');
    if (!existing) {
      titleEl.addEventListener('input', () => {
        if (!slugEl.dataset.touched) slugEl.value = slugify(titleEl.value);
      });
      slugEl.addEventListener('input', () => {
        slugEl.dataset.touched = '1';
      });
    }

    document.getElementById('ed-cancel').addEventListener('click', closeModal);
    document.getElementById('art-editor-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fb = document.getElementById('art-form-fb');
      const saveBtn = document.getElementById('ed-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const paras = document
        .getElementById('ed-body')
        .value.split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
      const excerptInput = document.getElementById('ed-excerpt').value.trim();
      const statusVal = document.getElementById('ed-status').value;

      const payload = {
        title: titleEl.value.trim(),
        slug: slugify(slugEl.value),
        category_id: document.getElementById('ed-cat').value,
        author_pen_name: document.getElementById('ed-pen').value.trim(),
        cover_image_url: document.getElementById('ed-cover').value.trim(),
        thumbnail_url: document.getElementById('ed-thumb').value.trim() || document.getElementById('ed-cover').value.trim(),
        excerpt: excerptInput || (paras[0] ? paras[0].slice(0, 220) + '...' : ''),
        content_paragraphs: paras,
        status: statusVal,
        display_date_label: document.getElementById('ed-date-label').value.trim() || formatDate(new Date().toISOString()),
        is_featured: isContentOrSuper() ? document.getElementById('ed-featured').checked : false,
        updated_by: state.profile.id,
      };
      if (statusVal === 'published' && (!existing || !existing.published_at)) {
        payload.published_at = new Date().toISOString();
      }
      if (!existing) {
        payload.author_id = state.profile.id;
      }

      try {
        let articleId = existing?.id;
        if (existing) {
          const { error } = await client.from('articles').update(payload).eq('id', existing.id);
          if (error) throw error;
        } else {
          const { data: inserted, error } = await client.from('articles').insert(payload).select('id').single();
          if (error) throw error;
          articleId = inserted.id;
        }

        // Sync tags
        if (articleId) {
          const checkedTagIds = Array.from(document.querySelectorAll('input[name="ed-tags"]:checked')).map((el) => el.value);
          await client.from('article_tags').delete().eq('article_id', articleId);
          if (checkedTagIds.length) {
            await client.from('article_tags').insert(checkedTagIds.map((tagId) => ({ article_id: articleId, tag_id: tagId })));
          }
        }

        if (prefill?.submissionId) {
          await client
            .from('reader_submissions')
            .update({
              status: 'converted_to_draft',
              converted_article_id: articleId,
              reviewed_by: state.profile.id,
            })
            .eq('id', prefill.submissionId);
        }

        closeModal();
        await refreshCoreData();
        renderCurrentSection();
      } catch (err) {
        fb.innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(err.message)}</div>`;
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Article';
      }
    });
  }

  // Categories & Tags
  function renderTaxonomies(view) {
    view.innerHTML = `
      <div id="tax-fb"></div>
      <div class="adm-grid-2" id="tax-root">
        <div class="adm-card">
          <div class="adm-card-head">
            <h2 class="adm-card-title">Categories</h2>
          </div>
          <form id="cat-add-form" style="display:flex;gap:8px;margin-bottom:16px;">
            <input id="cat-name-in" class="adm-input" required placeholder="New category name">
            <button type="submit" class="adm-btn adm-btn-primary">Add</button>
          </form>
          <table class="adm-table">
            <thead><tr><th>Name</th><th>Slug</th><th>Actions</th></tr></thead>
            <tbody>
              ${state.categories
                .map(
                  (c) => `<tr>
                    <td><strong>${escapeHtml(c.name)}</strong></td>
                    <td><code>${escapeHtml(c.slug)}</code></td>
                    <td><button type="button" class="adm-btn adm-btn-danger adm-btn-sm" data-del-cat="${escapeHtml(c.id)}">Delete</button></td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>

        <div class="adm-card">
          <div class="adm-card-head">
            <h2 class="adm-card-title">Tags</h2>
          </div>
          <form id="tag-add-form" style="display:flex;gap:8px;margin-bottom:16px;">
            <input id="tag-name-in" class="adm-input" required placeholder="New tag name">
            <button type="submit" class="adm-btn adm-btn-primary">Add</button>
          </form>
          <table class="adm-table">
            <thead><tr><th>Tag</th><th>Slug</th><th>Actions</th></tr></thead>
            <tbody>
              ${state.tags
                .map(
                  (t) => `<tr>
                    <td><strong>${escapeHtml(t.name)}</strong></td>
                    <td><code>${escapeHtml(t.slug)}</code></td>
                    <td><button type="button" class="adm-btn adm-btn-danger adm-btn-sm" data-del-tag="${escapeHtml(t.id)}">Delete</button></td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const taxRoot = document.getElementById('tax-root');
    const showTaxErr = (err) => {
      document.getElementById('tax-fb').innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(err.message)}</div>`;
    };

    document.getElementById('cat-add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('cat-name-in').value.trim();
      const { error } = await client.from('categories').insert({ name, slug: slugify(name), sort_order: state.categories.length + 1 });
      if (error) return showTaxErr(error);
      await refreshCoreData();
      renderTaxonomies(view);
    });
    document.getElementById('tag-add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('tag-name-in').value.trim();
      const { error } = await client.from('tags').insert({ name, slug: slugify(name) });
      if (error) return showTaxErr(error);
      await refreshCoreData();
      renderTaxonomies(view);
    });
    taxRoot.addEventListener('click', async (e) => {
      const dc = e.target.closest('[data-del-cat]');
      if (dc) {
        const { error } = await client.from('categories').delete().eq('id', dc.dataset.delCat);
        if (error) return showTaxErr(error);
        await refreshCoreData();
        renderTaxonomies(view);
      }
      const dt = e.target.closest('[data-del-tag]');
      if (dt) {
        const { error } = await client.from('tags').delete().eq('id', dt.dataset.delTag);
        if (error) return showTaxErr(error);
        await refreshCoreData();
        renderTaxonomies(view);
      }
    });
  }

  // Upcoming Updates & Site Banners
  function renderAnnouncements(view) {
    view.innerHTML = `
      <div class="adm-card" id="ann-root">
        <div class="adm-card-head">
          <h2 class="adm-card-title">Upcoming Updates &amp; Announcement Banners</h2>
          <button type="button" class="adm-btn adm-btn-primary" id="btn-new-ann">+ Add Announcement</button>
        </div>
        <div id="ann-fb"></div>
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead><tr><th>Title</th><th>Type</th><th>Category Label</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              ${state.announcements
                .map(
                  (a) => `<tr>
                    <td><strong>${escapeHtml(a.title)}</strong></td>
                    <td>${escapeHtml(a.kind)}</td>
                    <td>${escapeHtml(a.category_label)}</td>
                    <td><span class="adm-status ${a.is_active ? 'adm-status-active' : 'adm-status-inactive'}">${a.is_active ? 'Active' : 'Hidden'}</span></td>
                    <td style="white-space:nowrap;">
                      <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-toggle-ann="${escapeHtml(a.id)}">${a.is_active ? 'Hide' : 'Show'}</button>
                      <button type="button" class="adm-btn adm-btn-danger adm-btn-sm" data-del-ann="${escapeHtml(a.id)}">Delete</button>
                    </td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const annRoot = document.getElementById('ann-root');
    document.getElementById('btn-new-ann').addEventListener('click', () => {
      openModal(
        'New Announcement / Upcoming Preview',
        `<div id="ann-modal-fb"></div>
         <form id="ann-form">
          <div class="adm-field"><label>Type</label>
            <select id="ann-kind" class="adm-select">
              <option value="upcoming_update">Upcoming Story Preview (Stay Tuned)</option>
              <option value="site_banner">Top Site Announcement Banner</option>
            </select>
          </div>
          <div class="adm-field"><label>Title</label><input id="ann-title" class="adm-input" required></div>
          <div class="adm-field"><label>Summary</label><textarea id="ann-summary" class="adm-textarea" style="min-height:80px;"></textarea></div>
          <div class="adm-grid-2">
            <div class="adm-field"><label>Category Label</label><input id="ann-cat" class="adm-input" value="what will you do?"></div>
            <div class="adm-field"><label>Image URL</label><input id="ann-img" class="adm-input" value="img/upcoming/woman-teaching-bunch-keys.jpg" list="ann-media-list"></div>
          </div>
          <datalist id="ann-media-list">${state.media.map((m) => `<option value="${escapeHtml(m.public_url)}">`).join('')}</datalist>
          <div class="adm-grid-2">
            <div class="adm-field"><label>CTA Label (for banner)</label><input id="ann-cta-label" class="adm-input" placeholder="Read now"></div>
            <div class="adm-field"><label>CTA Link (for banner)</label><input id="ann-cta-url" class="adm-input" placeholder="/stories.html"></div>
          </div>
          <button type="submit" class="adm-btn adm-btn-primary">Save Announcement</button>
        </form>`
      );
      document.getElementById('ann-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const { error } = await client.from('announcements').insert({
          kind: document.getElementById('ann-kind').value,
          title: document.getElementById('ann-title').value.trim(),
          summary: document.getElementById('ann-summary').value.trim(),
          category_label: document.getElementById('ann-cat').value.trim(),
          image_url: document.getElementById('ann-img').value.trim(),
          cta_label: document.getElementById('ann-cta-label').value.trim(),
          cta_url: document.getElementById('ann-cta-url').value.trim(),
          is_active: true,
          created_by: state.profile.id,
        });
        if (error) {
          document.getElementById('ann-modal-fb').innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(error.message)}</div>`;
          return;
        }
        closeModal();
        await refreshCoreData();
        renderAnnouncements(view);
      });
    });

    annRoot.addEventListener('click', async (e) => {
      const tgl = e.target.closest('[data-toggle-ann]');
      if (tgl) {
        const ann = state.announcements.find((a) => a.id === tgl.dataset.toggleAnn);
        if (ann) {
          const { error } = await client.from('announcements').update({ is_active: !ann.is_active }).eq('id', ann.id);
          if (error) {
            document.getElementById('ann-fb').innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(error.message)}</div>`;
            return;
          }
          await refreshCoreData();
          renderAnnouncements(view);
        }
      }
      const del = e.target.closest('[data-del-ann]');
      if (del) {
        const { error } = await client.from('announcements').delete().eq('id', del.dataset.delAnn);
        if (error) {
          document.getElementById('ann-fb').innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(error.message)}</div>`;
          return;
        }
        await refreshCoreData();
        renderAnnouncements(view);
      }
    });
  }

  // Media Library & Supabase Storage Upload
  function renderMedia(view) {
    view.innerHTML = `
      <div class="adm-card" id="media-root">
        <div class="adm-card-head">
          <h2 class="adm-card-title">Media Library (Supabase Storage: blog-media)</h2>
          <form id="media-upload-form" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <input type="file" id="media-file-input" accept="image/jpeg,image/png,image/webp,image/gif" required>
            <input type="text" id="media-alt-input" class="adm-input" style="width:200px;" placeholder="Alt description">
            <button type="submit" class="adm-btn adm-btn-primary" id="media-upload-btn">Upload Image</button>
          </form>
        </div>
        <div id="media-fb"></div>
        <div class="adm-media-grid">
          ${state.media
            .map((m) => {
              const imgSrc = mediaUrl(m.public_url, '/img/frontpik2.jpg');
              return `
                <div class="adm-media-card">
                  <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(m.alt_text || m.file_name)}" referrerpolicy="no-referrer">
                  <div style="padding:10px 12px;">
                    <div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(m.file_name)}</div>
                    <div style="font-size:11px;color:#64748b;margin-bottom:8px;">${escapeHtml(m.bucket_name)}</div>
                    <div style="display:flex;gap:6px;">
                      <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-copy-url="${escapeHtml(m.public_url)}">Copy URL</button>
                      ${
                        m.bucket_name === 'blog-media' && (isContentOrSuper() || m.uploaded_by === state.profile.id)
                          ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" data-del-media="${escapeHtml(m.id)}">Delete</button>`
                          : ''
                      }
                    </div>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `;

    const mediaRoot = document.getElementById('media-root');
    document.getElementById('media-upload-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fb = document.getElementById('media-fb');
      const btn = document.getElementById('media-upload-btn');
      const file = document.getElementById('media-file-input').files[0];
      if (!file) return;

      btn.disabled = true;
      btn.textContent = 'Uploading...';
      fb.innerHTML = '';

      try {
        const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `uploads/${Date.now()}_${cleanName}`;
        const { error: upErr } = await client.storage.from('blog-media').upload(storagePath, file, {
          contentType: file.type,
          upsert: false,
        });
        if (upErr) throw upErr;

        const { data: pubData } = client.storage.from('blog-media').getPublicUrl(storagePath);
        const { error: dbErr } = await client.from('media_assets').insert({
          file_name: file.name,
          storage_path: storagePath,
          public_url: pubData.publicUrl,
          alt_text: document.getElementById('media-alt-input').value.trim() || file.name,
          bucket_name: 'blog-media',
          mime_type: file.type,
          file_size: file.size,
          uploaded_by: state.profile.id,
        });
        if (dbErr) throw dbErr;

        await refreshCoreData();
        renderMedia(view);
      } catch (err) {
        fb.innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(err.message)}</div>`;
        btn.disabled = false;
        btn.textContent = 'Upload Image';
      }
    });

    mediaRoot.addEventListener('click', async (e) => {
      const cp = e.target.closest('[data-copy-url]');
      if (cp) {
        try {
          await navigator.clipboard.writeText(cp.dataset.copyUrl);
          cp.textContent = 'Copied!';
          setTimeout(() => (cp.textContent = 'Copy URL'), 1500);
        } catch {
          cp.textContent = cp.dataset.copyUrl;
        }
      }
      const del = e.target.closest('[data-del-media]');
      if (del) {
        const item = state.media.find((m) => m.id === del.dataset.delMedia);
        if (!item) return;
        const { error: stErr } = await client.storage.from('blog-media').remove([item.storage_path]);
        const { error: dbErr } = await client.from('media_assets').delete().eq('id', item.id);
        if (stErr || dbErr) {
          document.getElementById('media-fb').innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml((stErr || dbErr).message)}</div>`;
          return;
        }
        await refreshCoreData();
        renderMedia(view);
      }
    });
  }

  // Reader Submissions & Enquiries
  function renderSubmissions(view) {
    view.innerHTML = `
      <div class="adm-card">
        <div class="adm-card-head">
          <h2 class="adm-card-title">Reader Story Submissions &amp; Enquiries</h2>
          <select id="sub-status-filter" class="adm-select" style="max-width:180px;">
            <option value="all">All Statuses</option>
            <option value="new">New</option>
            <option value="reviewing">Reviewing</option>
            <option value="converted_to_draft">Converted to Draft</option>
            <option value="resolved">Resolved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead><tr><th>Headline</th><th>Type</th><th>Sender</th><th>Date</th><th>Status</th><th>Action</th></tr></thead>
            <tbody id="sub-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    const drawSubs = () => {
      const filter = document.getElementById('sub-status-filter').value;
      const rows = state.submissions.filter((s) => filter === 'all' || s.status === filter);
      const tbody = document.getElementById('sub-tbody');
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:24px;">No submissions in this view.</td></tr>';
        return;
      }
      tbody.innerHTML = rows
        .map(
          (s) => `<tr>
            <td><strong>${escapeHtml(s.title)}</strong></td>
            <td>${escapeHtml(s.submission_type)}</td>
            <td>${escapeHtml(s.sender_name)}<div style="font-size:12px;color:#64748b;">${escapeHtml(s.sender_email)}</div></td>
            <td>${escapeHtml(formatDate(s.created_at))}</td>
            <td><span class="adm-status adm-status-${escapeHtml(s.status)}">${escapeHtml(s.status)}</span></td>
            <td><button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-open-sub="${escapeHtml(s.id)}">Inspect</button></td>
          </tr>`
        )
        .join('');
    };

    document.getElementById('sub-status-filter').addEventListener('change', drawSubs);
    document.getElementById('sub-tbody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-open-sub]');
      if (!btn) return;
      const sub = state.submissions.find((s) => s.id === btn.dataset.openSub);
      if (!sub) return;

      openModal(
        sub.title,
        `
        <div style="font-size:13px;color:#475569;margin-bottom:14px;">
          From <strong>${escapeHtml(sub.sender_name)}</strong> (${escapeHtml(sub.sender_email)}) · Section: <strong>${escapeHtml(sub.category_slug)}</strong> · Consent to publish: <strong>${sub.consent_to_publish ? 'Yes' : 'No'}</strong>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;white-space:pre-line;max-height:280px;overflow-y:auto;margin-bottom:18px;">${escapeHtml(sub.message_body)}</div>
        ${
          isContentOrSuper()
            ? `<form id="sub-review-form">
                <div class="adm-grid-2">
                  <div class="adm-field">
                    <label>Review Status</label>
                    <select id="sr-status" class="adm-select">
                      ${['new', 'reviewing', 'converted_to_draft', 'resolved', 'rejected'].map((st) => `<option value="${st}" ${sub.status === st ? 'selected' : ''}>${st}</option>`).join('')}
                    </select>
                  </div>
                  <div class="adm-field">
                    <label>Reviewer Notes</label>
                    <input id="sr-notes" class="adm-input" value="${escapeHtml(sub.reviewer_notes || '')}">
                  </div>
                </div>
                <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                  ${
                    sub.submission_type === 'story' && !sub.converted_article_id
                      ? `<button type="button" class="adm-btn adm-btn-secondary" id="sr-convert">Convert to Draft Article</button>`
                      : '<span></span>'
                  }
                  <button type="submit" class="adm-btn adm-btn-primary">Save Review</button>
                </div>
              </form>`
            : ''
        }
      `
      );

      document.getElementById('sub-review-form')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        await client
          .from('reader_submissions')
          .update({
            status: document.getElementById('sr-status').value,
            reviewer_notes: document.getElementById('sr-notes').value.trim(),
            reviewed_by: state.profile.id,
          })
          .eq('id', sub.id);
        closeModal();
        await refreshCoreData();
        renderSubmissions(view);
      });

      document.getElementById('sr-convert')?.addEventListener('click', () => {
        const cat = state.categories.find((c) => c.slug === sub.category_slug) || state.categories[0];
        openArticleEditor(null, {
          submissionId: sub.id,
          title: sub.title,
          slug: slugify(sub.title),
          category_id: cat?.id || '',
          author_pen_name: sub.sender_name || 'Anonymous',
          cover_image_url: 'img/frontpik2.jpg',
          thumbnail_url: 'img/frontpik2.jpg',
          excerpt: sub.message_body.slice(0, 220) + '...',
          content_paragraphs: sub.message_body.split(/\n\s*\n/).filter(Boolean),
          status: 'draft',
          is_featured: false,
          display_date_label: formatDate(new Date().toISOString()),
          article_tags: [],
        });
      });
    });

    drawSubs();
  }

  // Comments Moderation
  function renderComments(view) {
    view.innerHTML = `
      <div class="adm-card" id="comments-root">
        <div class="adm-card-head">
          <h2 class="adm-card-title">Reader Comments Moderation</h2>
        </div>
        <div id="comments-fb"></div>
        ${
          state.comments.length
            ? `<div class="adm-table-wrap"><table class="adm-table">
                <thead><tr><th>Reader</th><th>Story</th><th>Comment</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  ${state.comments
                    .map(
                      (c) => `<tr>
                        <td><strong>${escapeHtml(c.author_name)}</strong><div style="font-size:12px;color:#64748b;">${escapeHtml(c.author_email || 'No email')}</div></td>
                        <td>${escapeHtml(c.articles?.title || '')}</td>
                        <td style="max-width:340px;">${escapeHtml(c.body)}</td>
                        <td><span class="adm-status adm-status-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span></td>
                        <td style="white-space:nowrap;">
                          <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-mod-c="${escapeHtml(c.id)}" data-st="approved">Approve</button>
                          <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-mod-c="${escapeHtml(c.id)}" data-st="rejected">Reject</button>
                          <button type="button" class="adm-btn adm-btn-danger adm-btn-sm" data-del-c="${escapeHtml(c.id)}">Delete</button>
                        </td>
                      </tr>`
                    )
                    .join('')}
                </tbody>
              </table></div>`
            : '<p style="color:#64748b;margin:0;">No reader comments yet.</p>'
        }
      </div>
    `;

    const commentsRoot = document.getElementById('comments-root');
    commentsRoot.addEventListener('click', async (e) => {
      const mod = e.target.closest('[data-mod-c]');
      if (mod) {
        const { error } = await client
          .from('article_comments')
          .update({ status: mod.dataset.st, moderated_by: state.profile.id })
          .eq('id', mod.dataset.modC);
        if (error) {
          document.getElementById('comments-fb').innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(error.message)}</div>`;
          return;
        }
        await refreshCoreData();
        renderComments(view);
      }
      const del = e.target.closest('[data-del-c]');
      if (del) {
        const { error } = await client.from('article_comments').delete().eq('id', del.dataset.delC);
        if (error) {
          document.getElementById('comments-fb').innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(error.message)}</div>`;
          return;
        }
        await refreshCoreData();
        renderComments(view);
      }
    });
  }

  // Editorial Tasks
  function renderTasks(view) {
    const staffMap = Object.fromEntries(state.team.map((m) => [m.id, m.full_name || m.email]));
    view.innerHTML = `
      <div class="adm-card" id="tasks-root">
        <div class="adm-card-head">
          <h2 class="adm-card-title">Editorial Tasks</h2>
          ${isContentOrSuper() ? '<button type="button" class="adm-btn adm-btn-primary" id="btn-new-task">+ Assign Task</button>' : ''}
        </div>
        <div id="tasks-fb"></div>
        ${
          state.tasks.length
            ? `<div class="adm-table-wrap"><table class="adm-table">
                <thead><tr><th>Task</th><th>Assigned To</th><th>Priority</th><th>Due</th><th>Status</th><th>Update</th></tr></thead>
                <tbody>
                  ${state.tasks
                    .map((t) => {
                      const canUpdate = isContentOrSuper() || t.assigned_to === state.profile.id;
                      return `<tr>
                        <td><strong>${escapeHtml(t.title)}</strong><div style="font-size:12px;color:#64748b;">${escapeHtml(t.description || '')}</div></td>
                        <td>${escapeHtml(staffMap[t.assigned_to] || 'Unassigned')}</td>
                        <td>${escapeHtml(t.priority)}</td>
                        <td>${escapeHtml(t.due_date || '—')}</td>
                        <td><span class="adm-status adm-status-${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
                        <td>
                          ${
                            canUpdate
                              ? `<select class="adm-select" style="width:130px;padding:5px 8px;" data-task-status="${escapeHtml(t.id)}">
                                  ${['todo', 'in_progress', 'done'].map((st) => `<option value="${st}" ${t.status === st ? 'selected' : ''}>${st}</option>`).join('')}
                                </select>`
                              : '—'
                          }
                        </td>
                      </tr>`;
                    })
                    .join('')}
                </tbody>
              </table></div>`
            : '<p style="color:#64748b;margin:0;">No editorial tasks created yet.</p>'
        }
      </div>
    `;

    const tasksRoot = document.getElementById('tasks-root');
    document.getElementById('btn-new-task')?.addEventListener('click', () => {
      openModal(
        'Assign Editorial Task',
        `<div id="task-modal-fb"></div>
         <form id="task-form">
          <div class="adm-field"><label>Task Title</label><input id="tk-title" class="adm-input" required></div>
          <div class="adm-field"><label>Description</label><textarea id="tk-desc" class="adm-textarea" style="min-height:80px;"></textarea></div>
          <div class="adm-grid-2">
            <div class="adm-field"><label>Assign To</label>
              <select id="tk-assignee" class="adm-select">
                ${state.team.filter((m) => m.is_active).map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.full_name || m.email)} (${escapeHtml(m.role)})</option>`).join('')}
              </select>
            </div>
            <div class="adm-field"><label>Priority</label>
              <select id="tk-prio" class="adm-select">
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div class="adm-field"><label>Due Date</label><input id="tk-due" type="date" class="adm-input"></div>
          <button type="submit" class="adm-btn adm-btn-primary">Create Task</button>
        </form>`
      );

      document.getElementById('task-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const { error } = await client.from('editorial_tasks').insert({
          title: document.getElementById('tk-title').value.trim(),
          description: document.getElementById('tk-desc').value.trim(),
          assigned_to: document.getElementById('tk-assignee').value || null,
          priority: document.getElementById('tk-prio').value,
          due_date: document.getElementById('tk-due').value || null,
          created_by: state.profile.id,
        });
        if (error) {
          document.getElementById('task-modal-fb').innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(error.message)}</div>`;
          return;
        }
        closeModal();
        await refreshCoreData();
        renderTasks(view);
      });
    });

    tasksRoot.addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-task-status]');
      if (!sel) return;
      const { error } = await client.from('editorial_tasks').update({ status: sel.value }).eq('id', sel.dataset.taskStatus);
      if (error) {
        document.getElementById('tasks-fb').innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(error.message)}</div>`;
        return;
      }
      await refreshCoreData();
      renderTasks(view);
    });
  }

  // Pages & Site Settings
  function renderPages(view) {
    const hero = state.pages.find((p) => p.slug === 'home_hero')?.body || {};
    const about = state.pages.find((p) => p.slug === 'about_team')?.body || {};
    const settings = state.pages.find((p) => p.slug === 'site_settings')?.body || {};

    view.innerHTML = `
      <div id="pages-fb"></div>
      <div class="adm-card">
        <div class="adm-card-head"><h2 class="adm-card-title">Home Hero &amp; Publication Settings</h2></div>
        <form id="settings-form">
          <div class="adm-grid-2">
            <div class="adm-field"><label>Brand Title</label><input id="pg-brand" class="adm-input" value="${escapeHtml(hero.brandName || 'Bɔ-Me-Nkɔmmɔ')}"></div>
            <div class="adm-field"><label>Hero Tagline</label><input id="pg-tagline" class="adm-input" value="${escapeHtml(hero.tagline || '')}"></div>
          </div>
          <div class="adm-field"><label>Hero Intro Copy</label><textarea id="pg-intro" class="adm-textarea" style="min-height:70px;">${escapeHtml(hero.introText || '')}</textarea></div>
          <div class="adm-grid-2">
            <div class="adm-field"><label>Facebook Page URL</label><input id="pg-fb" class="adm-input" value="${escapeHtml(settings.facebookUrl || '')}"></div>
            <div class="adm-field"><label>Twitter / X URL</label><input id="pg-tw" class="adm-input" value="${escapeHtml(settings.twitterUrl || '')}"></div>
          </div>
          <div class="adm-grid-2">
            <div class="adm-field"><label>Instagram URL</label><input id="pg-ig" class="adm-input" value="${escapeHtml(settings.instagramUrl || '')}"></div>
            <div class="adm-field"><label>YouTube URL</label><input id="pg-yt" class="adm-input" value="${escapeHtml(settings.youtubeUrl || '')}"></div>
          </div>
          <button type="submit" class="adm-btn adm-btn-primary">Save Hero &amp; Settings</button>
        </form>
      </div>

      <div class="adm-card">
        <div class="adm-card-head"><h2 class="adm-card-title">About Bɔ-Me-Nkɔmmɔ Section</h2></div>
        <form id="about-form">
          <div class="adm-field"><label>Mission Introduction</label><textarea id="ab-intro" class="adm-textarea" style="min-height:80px;">${escapeHtml(about.intro || '')}</textarea></div>
          <div class="adm-field"><label>Who We Are</label><textarea id="ab-who" class="adm-textarea" style="min-height:80px;">${escapeHtml(about.whoWeAre || '')}</textarea></div>
          <div class="adm-field"><label>Our Promise</label><textarea id="ab-promise" class="adm-textarea" style="min-height:80px;">${escapeHtml(about.promise || '')}</textarea></div>
          <button type="submit" class="adm-btn adm-btn-primary">Save About Content</button>
        </form>
      </div>
    `;

    document.getElementById('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error: err1 } = await client.from('site_pages').upsert({
        slug: 'home_hero',
        title: document.getElementById('pg-brand').value.trim(),
        subtitle: document.getElementById('pg-tagline').value.trim(),
        body: {
          ...hero,
          brandName: document.getElementById('pg-brand').value.trim(),
          tagline: document.getElementById('pg-tagline').value.trim(),
          introText: document.getElementById('pg-intro').value.trim(),
        },
        updated_by: state.profile.id,
      }, { onConflict: 'slug' });

      const { error: err2 } = await client.from('site_pages').upsert({
        slug: 'site_settings',
        title: 'Publication Settings',
        body: {
          ...settings,
          publicationTitle: document.getElementById('pg-brand').value.trim(),
          facebookUrl: document.getElementById('pg-fb').value.trim(),
          twitterUrl: document.getElementById('pg-tw').value.trim(),
          instagramUrl: document.getElementById('pg-ig').value.trim(),
          youtubeUrl: document.getElementById('pg-yt').value.trim(),
        },
        updated_by: state.profile.id,
      }, { onConflict: 'slug' });

      if (err1 || err2) {
        document.getElementById('pages-fb').innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml((err1 || err2).message)}</div>`;
        return;
      }
      document.getElementById('pages-fb').innerHTML = '<div class="adm-alert adm-alert-success">Homepage &amp; settings updated on live site.</div>';
      await refreshCoreData();
    });

    document.getElementById('about-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error } = await client.from('site_pages').upsert({
        slug: 'about_team',
        title: 'About Bɔ-Me-Nkɔmmɔ Team',
        subtitle: 'Who we are.',
        body: {
          ...about,
          intro: document.getElementById('ab-intro').value.trim(),
          whoWeAre: document.getElementById('ab-who').value.trim(),
          promise: document.getElementById('ab-promise').value.trim(),
        },
        updated_by: state.profile.id,
      }, { onConflict: 'slug' });

      if (error) {
        document.getElementById('pages-fb').innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(error.message)}</div>`;
        return;
      }
      document.getElementById('pages-fb').innerHTML = '<div class="adm-alert adm-alert-success">About section updated on live site.</div>';
      await refreshCoreData();
    });
  }

  // Team & Roles (Super Admin only)
  function renderTeam(view) {
    view.innerHTML = `
      <div class="adm-card" id="team-root">
        <div class="adm-card-head">
          <h2 class="adm-card-title">Administrators &amp; Role Management</h2>
          <button type="button" class="adm-btn adm-btn-primary" id="btn-invite-staff">+ Invite Staff Member</button>
        </div>
        <div id="team-fb"></div>
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              ${state.team
                .map(
                  (m) => `<tr>
                    <td><strong>${escapeHtml(m.full_name || '—')}</strong></td>
                    <td>${escapeHtml(m.email)}</td>
                    <td>
                      <select class="adm-select" style="width:170px;padding:6px 8px;" data-member-role="${escapeHtml(m.id)}" ${m.id === state.profile.id ? 'disabled' : ''}>
                        ${['super_admin', 'content_admin', 'editor']
                          .map((r) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${roleLabels[r]}</option>`)
                          .join('')}
                      </select>
                    </td>
                    <td><span class="adm-status ${m.is_active ? 'adm-status-active' : 'adm-status-inactive'}">${m.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      ${
                        m.id !== state.profile.id
                          ? `<button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-toggle-member="${escapeHtml(m.id)}">${m.is_active ? 'Deactivate' : 'Activate'}</button>`
                          : '<span style="font-size:12px;color:#64748b;">Current User</span>'
                      }
                    </td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const teamRoot = document.getElementById('team-root');
    document.getElementById('btn-invite-staff').addEventListener('click', () => {
      openModal(
        'Invite Staff Member',
        `<div id="inv-fb"></div>
         <form id="inv-form">
           <div class="adm-field"><label>Full Name</label><input id="inv-name" class="adm-input" required></div>
           <div class="adm-field"><label>Email Address</label><input id="inv-email" type="email" class="adm-input" required></div>
           <div class="adm-field"><label>Assigned Role</label>
             <select id="inv-role" class="adm-select">
               <option value="editor">Editor</option>
               <option value="content_admin">Content Administrator</option>
               <option value="super_admin">Super Administrator</option>
             </select>
           </div>
           <button type="submit" class="adm-btn adm-btn-primary" id="inv-submit">Send Invitation</button>
         </form>`
      );

      document.getElementById('inv-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fb = document.getElementById('inv-fb');
        const btn = document.getElementById('inv-submit');
        btn.disabled = true;
        btn.textContent = 'Sending...';
        try {
          const { data, error } = await client.functions.invoke('admin-users', {
            body: {
              action: 'invite',
              full_name: document.getElementById('inv-name').value.trim(),
              email: document.getElementById('inv-email').value.trim(),
              role: document.getElementById('inv-role').value,
            },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          closeModal();
          await refreshCoreData();
          renderTeam(view);
        } catch (err) {
          fb.innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(err.message || 'Ensure the admin-users Edge Function is deployed.')}</div>`;
          btn.disabled = false;
          btn.textContent = 'Send Invitation';
        }
      });
    });

    teamRoot.addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-member-role]');
      if (!sel) return;
      const { error } = await client.from('profiles').update({ role: sel.value }).eq('id', sel.dataset.memberRole);
      if (error) {
        document.getElementById('team-fb').innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(error.message)}</div>`;
      } else {
        await refreshCoreData();
        renderTeam(view);
      }
    });

    teamRoot.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-toggle-member]');
      if (!btn) return;
      const member = state.team.find((m) => m.id === btn.dataset.toggleMember);
      if (!member) return;
      const { error } = await client.from('profiles').update({ is_active: !member.is_active }).eq('id', member.id);
      if (error) {
        document.getElementById('team-fb').innerHTML = `<div class="adm-alert adm-alert-error">${escapeHtml(error.message)}</div>`;
      } else {
        await refreshCoreData();
        renderTeam(view);
      }
    });
  }

  // Activity Logs
  function renderLogs(view) {
    view.innerHTML = `
      <div class="adm-card">
        <div class="adm-card-head"><h2 class="adm-card-title">Administrator Activity Logs</h2></div>
        ${
          state.logs.length
            ? `<div class="adm-table-wrap"><table class="adm-table">
                <thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Summary</th></tr></thead>
                <tbody>
                  ${state.logs
                    .map(
                      (l) => `<tr>
                        <td style="white-space:nowrap;font-variant-numeric:tabular-nums;">${escapeHtml(new Date(l.created_at).toLocaleString())}</td>
                        <td>${escapeHtml(l.actor_email)}</td>
                        <td><code>${escapeHtml(l.action)}</code></td>
                        <td>${escapeHtml(l.summary)}</td>
                      </tr>`
                    )
                    .join('')}
                </tbody>
              </table></div>`
            : '<p style="color:#64748b;margin:0;">No activity recorded yet.</p>'
        }
      </div>
    `;
  }

  await refreshCoreData();
  switchSection('overview');
})();
