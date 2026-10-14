/**
 * VeloURL - Frontend Logic & Dashboard Engine
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const shortenForm = document.getElementById('shortenForm');
  const longUrlInput = document.getElementById('longUrlInput');
  const submitBtn = document.getElementById('submitBtn');
  const toggleOptionsBtn = document.getElementById('toggleOptionsBtn');
  const advancedOptionsPanel = document.getElementById('advancedOptionsPanel');
  const customAliasInput = document.getElementById('customAliasInput');
  const aliasStatus = document.getElementById('aliasStatus');
  const linkTitleInput = document.getElementById('linkTitleInput');
  const expirationSelect = document.getElementById('expirationSelect');

  // Result Elements
  const resultBanner = document.getElementById('resultBanner');
  const resultShortUrl = document.getElementById('resultShortUrl');
  const resultMeta = document.getElementById('resultMeta');
  const copyResultBtn = document.getElementById('copyResultBtn');
  const visitResultBtn = document.getElementById('visitResultBtn');
  const qrResultBtn = document.getElementById('qrResultBtn');

  // Stats Ticker
  const totalLinksCount = document.getElementById('totalLinksCount');
  const totalClicksCount = document.getElementById('totalClicksCount');
  const activeLinksCount = document.getElementById('activeLinksCount');

  // Dashboard Controls
  const searchLinksInput = document.getElementById('searchLinksInput');
  const filterTabs = document.querySelectorAll('.filter-tab');
  const linksList = document.getElementById('linksList');
  const linksLoading = document.getElementById('linksLoading');
  const linksEmpty = document.getElementById('linksEmpty');

  // Modals
  const qrModal = document.getElementById('qrModal');
  const qrImage = document.getElementById('qrImage');
  const qrTargetUrl = document.getElementById('qrTargetUrl');
  const downloadQrBtn = document.getElementById('downloadQrBtn');

  const analyticsModal = document.getElementById('analyticsModal');
  const analyticsTitle = document.getElementById('analyticsTitle');
  const analyticsShortUrl = document.getElementById('analyticsShortUrl');
  const analyticsStatusBadge = document.getElementById('analyticsStatusBadge');
  const analyticsTotalClicks = document.getElementById('analyticsTotalClicks');
  const analyticsCreatedAt = document.getElementById('analyticsCreatedAt');
  const analyticsOriginalUrl = document.getElementById('analyticsOriginalUrl');
  const dailyClicksChart = document.getElementById('dailyClicksChart');
  const devicesBreakdownList = document.getElementById('devicesBreakdownList');
  const browsersBreakdownList = document.getElementById('browsersBreakdownList');
  const osBreakdownList = document.getElementById('osBreakdownList');
  const referrersBreakdownList = document.getElementById('referrersBreakdownList');
  const clickStreamBody = document.getElementById('clickStreamBody');

  const toastContainer = document.getElementById('toastContainer');

  // State
  let currentFilter = 'all';
  let searchQuery = '';
  let aliasCheckTimeout = null;
  let activeQrCode = null;

  // Initialize
  init();

  function init() {
    setupEventListeners();
    fetchGlobalStats();
    loadLinks();
  }

  function setupEventListeners() {
    // Advanced options accordion toggle
    toggleOptionsBtn.addEventListener('click', () => {
      const isHidden = advancedOptionsPanel.classList.toggle('hidden');
      toggleOptionsBtn.classList.toggle('open', !isHidden);
    });

    // Custom alias availability checker
    customAliasInput.addEventListener('input', () => {
      clearTimeout(aliasCheckTimeout);
      const val = customAliasInput.value.trim();

      if (!val) {
        aliasStatus.textContent = 'Optional';
        aliasStatus.className = 'alias-status';
        return;
      }

      if (val.length < 3) {
        aliasStatus.textContent = 'Min 3 chars';
        aliasStatus.className = 'alias-status taken';
        return;
      }

      aliasStatus.textContent = 'Checking...';
      aliasStatus.className = 'alias-status';

      aliasCheckTimeout = setTimeout(async () => {
        try {
          const res = await fetch(`/api/check-code/${encodeURIComponent(val)}`);
          const data = await res.json();
          if (data.available) {
            aliasStatus.textContent = 'Available';
            aliasStatus.className = 'alias-status available';
          } else {
            aliasStatus.textContent = 'Unavailable';
            aliasStatus.className = 'alias-status taken';
          }
        } catch (e) {
          aliasStatus.textContent = 'Check failed';
        }
      }, 350);
    });

    // Shorten Form Submit
    shortenForm.addEventListener('submit', handleShortenSubmit);

    // Search and filter
    searchLinksInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      loadLinks();
    });

    filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter;
        loadLinks();
      });
    });

    // Result action buttons
    copyResultBtn.addEventListener('click', () => {
      copyToClipboard(resultShortUrl.value);
    });

    qrResultBtn.addEventListener('click', () => {
      if (activeQrCode) openQrModal(activeQrCode);
    });

    // Modal close listeners
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-close');
        document.getElementById(targetId)?.classList.add('hidden');
      });
    });

    // Close on backdrop click
    [qrModal, analyticsModal].forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        qrModal.classList.add('hidden');
        analyticsModal.classList.add('hidden');
      }
    });
  }

  // Handle URL Shortening
  async function handleShortenSubmit(e) {
    e.preventDefault();

    const originalUrl = longUrlInput.value.trim();
    if (!originalUrl) {
      showToast('Please enter a destination URL', 'error');
      return;
    }

    const customCode = customAliasInput.value.trim();
    const title = linkTitleInput.value.trim();
    const expiresInHours = expirationSelect.value ? Number(expirationSelect.value) : null;

    setButtonLoading(true);

    try {
      const response = await fetch('/api/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalUrl, customCode, title, expiresInHours })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to shorten URL');
      }

      const item = result.data;
      activeQrCode = item.code;

      // Populate Result Banner
      resultShortUrl.value = item.short_url;
      visitResultBtn.href = item.short_url;

      let metaText = `Alias: /${item.code}`;
      if (item.expires_at) {
        const expDate = new Date(item.expires_at).toLocaleString();
        metaText += ` &bull; Expires: ${expDate}`;
      }
      resultMeta.innerHTML = metaText;

      resultBanner.classList.remove('hidden');

      showToast('Short URL generated successfully!', 'success');

      // Refresh links and stats
      fetchGlobalStats();
      loadLinks();

    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setButtonLoading(false);
    }
  }

  function setButtonLoading(loading) {
    if (loading) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <span class="spinner" style="width:18px;height:18px;border-width:2px;margin:0 4px;"></span>
        <span>Processing...</span>
      `;
    } else {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <span class="btn-text">Shorten URL</span>
        <span class="btn-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </span>
      `;
    }
  }

  // Fetch Global Stats
  async function fetchGlobalStats() {
    try {
      const res = await fetch('/api/stats/global');
      const data = await res.json();
      if (data.success) {
        totalLinksCount.textContent = Number(data.data.totalLinks).toLocaleString();
        totalClicksCount.textContent = Number(data.data.totalClicks).toLocaleString();
        activeLinksCount.textContent = Number(data.data.activeLinks).toLocaleString();
      }
    } catch (err) {
      console.error('Failed to load global metrics:', err);
    }
  }

  // Load Links Dashboard
  async function loadLinks() {
    linksLoading.classList.remove('hidden');
    linksEmpty.classList.add('hidden');
    linksList.innerHTML = '';

    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (currentFilter && currentFilter !== 'all') params.append('filter', currentFilter);

      const res = await fetch(`/api/links?${params.toString()}`);
      const data = await res.json();

      linksLoading.classList.add('hidden');

      if (!data.success || !data.data || data.data.length === 0) {
        linksEmpty.classList.remove('hidden');
        return;
      }

      data.data.forEach(link => {
        const card = createLinkCardElement(link);
        linksList.appendChild(card);
      });
    } catch (err) {
      linksLoading.classList.add('hidden');
      linksEmpty.classList.remove('hidden');
      showToast('Could not load links', 'error');
    }
  }

  // Create DOM node for Link Card
  function createLinkCardElement(link) {
    const card = document.createElement('div');
    const isExpired = link.is_expired;
    const isPaused = !link.is_active;

    let cardClass = 'link-card';
    if (isExpired) cardClass += ' expired';
    else if (isPaused) cardClass += ' paused';
    card.className = cardClass;

    const createdFormatted = new Date(link.created_at).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    let statusHtml = '';
    if (isExpired) {
      statusHtml = '<span class="meta-status-tag expired">&bull; Expired</span>';
    } else if (isPaused) {
      statusHtml = '<span class="meta-status-tag paused">&bull; Paused</span>';
    } else {
      statusHtml = '<span class="meta-status-tag active">&bull; Active</span>';
    }

    let expiryHtml = '';
    if (link.expires_at) {
      const expDate = new Date(link.expires_at);
      const isPast = expDate < new Date();
      expiryHtml = `<span>${isPast ? 'Expired on' : 'Expires'}: ${expDate.toLocaleDateString()}</span>`;
    }

    card.innerHTML = `
      <div class="link-main-info">
        <div class="link-title-row">
          <a href="${escapeHtml(link.short_url)}" target="_blank" rel="noopener" class="link-short-url">
            ${escapeHtml(link.short_url)}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
          ${link.title ? `<span class="link-title-badge">${escapeHtml(link.title)}</span>` : ''}
        </div>
        <div class="link-original-url" title="${escapeHtml(link.original_url)}">
          Destination: ${escapeHtml(link.original_url)}
        </div>
        <div class="link-meta-row">
          ${statusHtml}
          <span>Created: ${createdFormatted}</span>
          ${expiryHtml}
        </div>
      </div>

      <div class="link-stats-group">
        <button type="button" class="click-counter-btn" data-analytics="${escapeHtml(link.code)}" title="View Detailed Click Telemetry">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
            <polyline points="17 6 23 6 23 12"></polyline>
          </svg>
          <span>${Number(link.clicks || 0).toLocaleString()} Clicks</span>
        </button>

        <div class="card-actions">
          <button type="button" class="icon-btn" data-copy="${escapeHtml(link.short_url)}" title="Copy short URL">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button type="button" class="icon-btn" data-qr="${escapeHtml(link.code)}" title="Show QR Code">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7"></rect>
              <rect x="14" y="3" width="7" height="7"></rect>
              <rect x="14" y="14" width="7" height="7"></rect>
              <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
          </button>
          <button type="button" class="icon-btn toggle-btn ${link.is_active ? 'active' : ''}" data-toggle="${escapeHtml(link.code)}" title="${link.is_active ? 'Pause redirect' : 'Resume redirect'}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polygon points="10 8 16 12 10 16 10 8"></polygon>
            </svg>
          </button>
          <button type="button" class="icon-btn delete-btn" data-delete="${escapeHtml(link.code)}" title="Delete link permanently">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Bind item buttons
    card.querySelector('[data-copy]').addEventListener('click', () => {
      copyToClipboard(link.short_url);
    });

    card.querySelector('[data-qr]').addEventListener('click', () => {
      openQrModal(link.code);
    });

    card.querySelector('[data-analytics]').addEventListener('click', () => {
      openAnalyticsModal(link.code);
    });

    card.querySelector('[data-toggle]').addEventListener('click', async () => {
      await toggleLinkActive(link.code);
    });

    card.querySelector('[data-delete]').addEventListener('click', async () => {
      if (confirm(`Are you sure you want to delete /${link.code}? This will remove all associated analytics.`)) {
        await deleteLink(link.code);
      }
    });

    return card;
  }

  // Open QR Modal
  async function openQrModal(code) {
    try {
      const res = await fetch(`/api/qr/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      qrImage.src = data.qr;
      qrTargetUrl.textContent = data.destination;
      downloadQrBtn.href = data.qr;
      downloadQrBtn.download = `velo-${code}-qr.png`;

      qrModal.classList.remove('hidden');
    } catch (err) {
      showToast('Failed to generate QR code', 'error');
    }
  }

  // Open Analytics Modal
  async function openAnalyticsModal(code) {
    try {
      const res = await fetch(`/api/analytics/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const analytics = data.data;
      const url = analytics.url;

      analyticsTitle.textContent = url.title ? `${url.title} (/${url.code})` : `/${url.code}`;
      analyticsShortUrl.textContent = url.short_url;

      // Status badge
      if (url.is_expired) {
        analyticsStatusBadge.textContent = 'Expired';
        analyticsStatusBadge.className = 'badge-mini expired';
      } else if (!url.is_active) {
        analyticsStatusBadge.textContent = 'Paused';
        analyticsStatusBadge.className = 'badge-mini paused';
      } else {
        analyticsStatusBadge.textContent = 'Active';
        analyticsStatusBadge.className = 'badge-mini';
      }

      analyticsTotalClicks.textContent = Number(analytics.totalClicks).toLocaleString();
      analyticsCreatedAt.textContent = new Date(url.created_at).toLocaleDateString();
      analyticsOriginalUrl.textContent = url.original_url;
      analyticsOriginalUrl.title = url.original_url;

      // Render Bar Chart (Daily clicks)
      renderDailyChart(analytics.clicksByDate);

      // Render Breakdowns
      renderBreakdown(devicesBreakdownList, analytics.deviceBreakdown, analytics.totalClicks);
      renderBreakdown(browsersBreakdownList, analytics.browserBreakdown, analytics.totalClicks);
      renderBreakdown(osBreakdownList, analytics.osBreakdown, analytics.totalClicks);
      renderBreakdown(referrersBreakdownList, analytics.referrerBreakdown, analytics.totalClicks);

      // Render Recent Stream
      renderClickStream(analytics.recentClicks);

      analyticsModal.classList.remove('hidden');
    } catch (err) {
      showToast('Failed to load analytics', 'error');
    }
  }

  // Render Daily Click Bars
  function renderDailyChart(clicksByDate) {
    dailyClicksChart.innerHTML = '';
    const dates = Object.keys(clicksByDate).sort();

    if (dates.length === 0) {
      dailyClicksChart.innerHTML = '<div style="margin:auto;color:var(--text-dim);font-size:13px;">No recorded visits yet</div>';
      return;
    }

    const maxVal = Math.max(...Object.values(clicksByDate), 1);

    dates.forEach(date => {
      const count = clicksByDate[date];
      const heightPercent = Math.max((count / maxVal) * 100, 6);

      const barGroup = document.createElement('div');
      barGroup.className = 'chart-bar-group';

      const shortLabel = date.slice(5); // MM-DD

      barGroup.innerHTML = `
        <div class="chart-bar-val">${count}</div>
        <div class="chart-bar" style="height: ${heightPercent}%;"></div>
        <div class="chart-bar-label">${shortLabel}</div>
      `;

      dailyClicksChart.appendChild(barGroup);
    });
  }

  // Render Horizontal Percentage Breakdown Bars
  function renderBreakdown(container, mapData, total) {
    container.innerHTML = '';
    const keys = Object.keys(mapData || {});

    if (keys.length === 0 || total === 0) {
      container.innerHTML = '<div style="color:var(--text-dim);font-size:12px;">No data</div>';
      return;
    }

    keys.sort((a, b) => mapData[b] - mapData[a]);

    keys.forEach(key => {
      const count = mapData[key];
      const pct = Math.round((count / total) * 100);

      const row = document.createElement('div');
      row.className = 'breakdown-row';
      row.innerHTML = `
        <div class="breakdown-row-info">
          <span class="breakdown-name">${escapeHtml(key)}</span>
          <span class="breakdown-count">${count} (${pct}%)</span>
        </div>
        <div class="breakdown-bar-bg">
          <div class="breakdown-bar-fill" style="width: ${pct}%;"></div>
        </div>
      `;
      container.appendChild(row);
    });
  }

  // Render Click Stream Table
  function renderClickStream(recentClicks) {
    clickStreamBody.innerHTML = '';

    if (!recentClicks || recentClicks.length === 0) {
      clickStreamBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:24px;">No visits recorded yet.</td></tr>';
      return;
    }

    recentClicks.forEach(click => {
      const tr = document.createElement('tr');
      const timeStr = new Date(click.timestamp).toLocaleString();

      tr.innerHTML = `
        <td style="font-family:'JetBrains Mono', monospace; font-size:11px;">${timeStr}</td>
        <td>${escapeHtml(click.device_type)} / ${escapeHtml(click.os)}</td>
        <td>${escapeHtml(click.browser)}</td>
        <td><span class="link-title-badge">${escapeHtml(click.referrer)}</span></td>
        <td style="font-family:'JetBrains Mono', monospace; color:var(--text-dim);">${escapeHtml(click.ip)}</td>
      `;
      clickStreamBody.appendChild(tr);
    });
  }

  // Toggle Active State
  async function toggleLinkActive(code) {
    try {
      const res = await fetch(`/api/links/${encodeURIComponent(code)}/toggle`, {
        method: 'PATCH'
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      showToast(`Link /${code} status updated`, 'success');
      fetchGlobalStats();
      loadLinks();
    } catch (err) {
      showToast('Failed to toggle status', 'error');
    }
  }

  // Delete Link
  async function deleteLink(code) {
    try {
      const res = await fetch(`/api/links/${encodeURIComponent(code)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      showToast(`Link /${code} deleted`, 'success');
      fetchGlobalStats();
      loadLinks();
    } catch (err) {
      showToast('Failed to delete link', 'error');
    }
  }

  // Copy to Clipboard
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!', 'success');
      }).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const input = document.createElement('textarea');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    try {
      document.execCommand('copy');
      showToast('Copied to clipboard!', 'success');
    } catch (e) {
      showToast('Could not copy link', 'error');
    }
    document.body.removeChild(input);
  }

  // Toast System
  function showToast(message, type = 'default') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    } else if (type === 'error') {
      iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    }

    toast.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  // Utility to escape HTML
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
