// Admin Dashboard Client-side Application
(function () {
  'use strict';

  // State
  let csrfToken = null;
  let currentUser = null;
  let currentKeys = [];
  let pendingActionKey = null;

  // DOM Elements - Views
  const viewLogin = document.getElementById('view-login');
  const viewDashboard = document.getElementById('view-dashboard');

  // DOM Elements - Auth & Header
  const formLogin = document.getElementById('form-login');
  const inputUsername = document.getElementById('login-username');
  const inputPassword = document.getElementById('login-password');
  const btnLogin = document.getElementById('btn-login');
  const loginError = document.getElementById('login-error');
  const btnLogout = document.getElementById('btn-logout');
  const displayUser = document.getElementById('display-user');

  // DOM Elements - Tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // DOM Elements - Metrics
  const statTotalKeys = document.getElementById('stat-total-keys');
  const statKeysBreakdown = document.getElementById('stat-keys-breakdown');
  const statActiveKeys = document.getElementById('stat-active-keys');
  const statRevokedKeys = document.getElementById('stat-revoked-keys');
  const statTotalRequests = document.getElementById('stat-total-requests');
  const statSuccessRequests = document.getElementById('stat-success-requests');
  const statSuccessRate = document.getElementById('stat-success-rate');
  const statFailedRequests = document.getElementById('stat-failed-requests');
  const overviewRecentKeysTbody = document.getElementById('overview-recent-keys-tbody');

  // DOM Elements - Keys Table & Filters
  const keysTableTbody = document.getElementById('keys-table-tbody');
  const keysSearchInput = document.getElementById('keys-search-input');
  const keysStatusFilter = document.getElementById('keys-status-filter');
  const btnRefreshKeys = document.getElementById('btn-refresh-keys');

  // DOM Elements - Modals
  const modalCreateKey = document.getElementById('modal-create-key');
  const formCreateKey = document.getElementById('form-create-key');
  const keyProjectName = document.getElementById('key-project-name');
  const keyDescription = document.getElementById('key-description');
  const keyExpiration = document.getElementById('key-expiration');
  const keyRateLimit = document.getElementById('key-rate-limit');
  const createKeyError = document.getElementById('create-key-error');

  const modalSecretReveal = document.getElementById('modal-secret-reveal');
  const revealedSecretKey = document.getElementById('revealed-secret-key');
  const btnCopySecret = document.getElementById('btn-copy-secret');
  const btnCloseSecretReveal = document.getElementById('btn-close-secret-reveal');

  const modalKeyDetails = document.getElementById('modal-key-details');
  const detailsMetadataContent = document.getElementById('details-metadata-content');
  const detailsUsageTbody = document.getElementById('details-usage-tbody');

  const modalRevokeConfirm = document.getElementById('modal-revoke-confirm');
  const revokeTargetProject = document.getElementById('revoke-target-project');
  const revokeTargetPrefix = document.getElementById('revoke-target-prefix');
  const btnConfirmRevoke = document.getElementById('btn-confirm-revoke');

  const modalRotateConfirm = document.getElementById('modal-rotate-confirm');
  const rotateTargetProject = document.getElementById('rotate-target-project');
  const btnConfirmRotate = document.getElementById('btn-confirm-rotate');

  // Dynamic documentation endpoint URL
  const docEndpointUrl = document.getElementById('doc-endpoint-url');
  if (docEndpointUrl) {
    docEndpointUrl.textContent = `${window.location.origin}/api/support/login-diagnostics`;
  }

  /**
   * Universal authenticated fetch wrapper
   */
  async function apiFetch(url, options = {}) {
    const opts = { ...options };
    opts.credentials = 'include';
    opts.headers = {
      Accept: 'application/json',
      ...(opts.headers || {}),
    };

    if (csrfToken && ['POST', 'PATCH', 'PUT', 'DELETE'].includes((opts.method || 'GET').toUpperCase())) {
      opts.headers['x-csrf-token'] = csrfToken;
    }

    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, opts);
    if (res.status === 401 && !url.includes('/login') && !url.includes('/session')) {
      // Session expired, return to login
      showLoginView();
      throw new Error('Session expired');
    }

    const data = await res.json().catch(() => ({ success: false, error: { message: 'Unexpected server response.' } }));
    if (!res.ok && !data.error) {
      data.error = { message: `Request failed with HTTP ${res.status}` };
    }
    return { ok: res.ok, status: res.status, data };
  }

  /**
   * Helper: Date formatting
   */
  function formatDate(isoStr) {
    if (!isoStr) return 'Never';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoStr;
    }
  }

  /**
   * Status badge HTML helper
   */
  function renderStatusBadge(status, expiresAt) {
    let effectiveStatus = status;
    if (status === 'active' && expiresAt && new Date(expiresAt) <= new Date()) {
      effectiveStatus = 'expired';
    }

    return `
      <span class="status-badge ${effectiveStatus}">
        <span class="status-dot"></span>
        ${effectiveStatus}
      </span>
    `;
  }

  /**
   * View Management
   */
  function showLoginView() {
    viewLogin.hidden = false;
    viewDashboard.hidden = true;
    currentUser = null;
    csrfToken = null;
  }

  function showDashboardView(user) {
    viewLogin.hidden = true;
    viewDashboard.hidden = false;
    currentUser = user;
    displayUser.textContent = user;
    loadDashboardMetrics();
    loadKeys();
  }

  /**
   * Check Session on load
   */
  async function checkSession() {
    try {
      const { ok, data } = await apiFetch('/api/admin/session');
      if (ok && data.authenticated) {
        csrfToken = data.csrfToken;
        showDashboardView(data.user.username);
      } else {
        showLoginView();
      }
    } catch {
      showLoginView();
    }
  }

  /**
   * Login handler
   */
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    btnLogin.disabled = true;

    const username = inputUsername.value.trim();
    const password = inputPassword.value;

    try {
      const { ok, data } = await apiFetch('/api/admin/login', {
        method: 'POST',
        body: { username, password },
      });

      if (ok && data.success) {
        csrfToken = data.csrfToken;
        inputPassword.value = '';
        showDashboardView(data.user.username);
      } else {
        loginError.textContent = data.error?.message || 'Invalid username or password.';
        loginError.hidden = false;
      }
    } catch (err) {
      loginError.textContent = 'Connection error. Please try again.';
      loginError.hidden = false;
    } finally {
      btnLogin.disabled = false;
    }
  });

  /**
   * Logout handler
   */
  btnLogout.addEventListener('click', async () => {
    try {
      await apiFetch('/api/admin/logout', { method: 'POST' });
    } finally {
      showLoginView();
    }
  });

  /**
   * Tab Navigation
   */
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');

      tabBtns.forEach((b) => b.classList.remove('active'));
      tabPanes.forEach((p) => (p.hidden = true));

      btn.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.hidden = false;

      if (targetId === 'tab-overview') loadDashboardMetrics();
      if (targetId === 'tab-keys') loadKeys();
    });
  });

  /**
   * Load Dashboard Overview Metrics
   */
  async function loadDashboardMetrics() {
    try {
      const { ok, data } = await apiFetch('/api/admin/dashboard');
      if (!ok || !data.success) return;

      const s = data.stats;
      statTotalKeys.textContent = s.totalKeys.toLocaleString();
      statKeysBreakdown.textContent = `${s.activeKeys} active, ${s.revokedKeys} revoked`;
      statActiveKeys.textContent = s.activeKeys.toLocaleString();
      statRevokedKeys.textContent = (s.revokedKeys + s.expiredKeys).toLocaleString();
      statTotalRequests.textContent = s.totalRequests.toLocaleString();
      statSuccessRequests.textContent = s.successfulRequests.toLocaleString();
      statFailedRequests.textContent = s.failedRequests.toLocaleString();

      const rate = s.totalRequests > 0 ? ((s.successfulRequests / s.totalRequests) * 100).toFixed(1) : '100';
      statSuccessRate.textContent = `${rate}% success rate`;

      // Render recent keys table on overview
      if (!s.recentKeys || s.recentKeys.length === 0) {
        overviewRecentKeysTbody.innerHTML = `
          <tr>
            <td colspan="7" class="empty-state">
              <div class="empty-icon">🔑</div>
              <div>No API keys generated yet. Click "+ Generate New Key" to create your first key.</div>
            </td>
          </tr>
        `;
      } else {
        overviewRecentKeysTbody.innerHTML = s.recentKeys
          .map((k) => `
            <tr>
              <td><strong>${escapeHtml(k.projectName)}</strong></td>
              <td><code class="font-mono" style="color: #38bdf8;">${escapeHtml(k.keyPrefix)}</code></td>
              <td>${renderStatusBadge(k.status, k.expiresAt)}</td>
              <td>${formatDate(k.createdAt)}</td>
              <td>${formatDate(k.lastUsedAt)}</td>
              <td>${k.totalRequests}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="window.adminApp.openDetails('${k.id}')">View</button>
              </td>
            </tr>
          `)
          .join('');
      }
    } catch (err) {
      console.error('Failed to load dashboard stats:', err);
    }
  }

  /**
   * Load Keys List
   */
  async function loadKeys() {
    const search = keysSearchInput.value.trim();
    const status = keysStatusFilter.value;

    let url = `/api/admin/keys?limit=100`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (status && status !== 'all') url += `&status=${encodeURIComponent(status)}`;

    try {
      const { ok, data } = await apiFetch(url);
      if (!ok || !data.success) {
        keysTableTbody.innerHTML = `<tr><td colspan="8" class="empty-state">Failed to load API keys.</td></tr>`;
        return;
      }

      currentKeys = data.keys;

      if (currentKeys.length === 0) {
        keysTableTbody.innerHTML = `
          <tr>
            <td colspan="8" class="empty-state">
              <div class="empty-icon">🔍</div>
              <div>No matching API keys found.</div>
            </td>
          </tr>
        `;
        return;
      }

      keysTableTbody.innerHTML = currentKeys
        .map((k) => {
          const isRevoked = k.status === 'revoked';
          const isExpired = k.expiresAt && new Date(k.expiresAt) <= new Date();
          const toggleActionText = k.status === 'active' ? 'Disable' : 'Enable';
          const toggleActionDisabled = isRevoked || isExpired;

          return `
            <tr>
              <td>
                <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(k.projectName)}</div>
                ${k.description ? `<div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(k.description)}</div>` : ''}
              </td>
              <td>
                <code class="font-mono" style="color: #38bdf8; font-size: 0.8125rem;">${escapeHtml(k.keyPrefix)}</code>
              </td>
              <td>${renderStatusBadge(k.status, k.expiresAt)}</td>
              <td>${formatDate(k.createdAt)}</td>
              <td>${k.expiresAt ? formatDate(k.expiresAt) : '<span style="color: var(--text-muted);">Never</span>'}</td>
              <td>${formatDate(k.lastUsedAt)}</td>
              <td>
                <strong>${k.totalRequests}</strong>
                <span style="font-size: 0.75rem; color: var(--text-muted);">(${k.successfulRequests} ok / ${k.failedRequests} err)</span>
              </td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-secondary btn-sm" onclick="window.adminApp.openDetails('${k.id}')">Details</button>
                  ${
                    !isRevoked
                      ? `
                    <button class="btn btn-secondary btn-sm" ${toggleActionDisabled ? 'disabled' : ''} onclick="window.adminApp.toggleStatus('${k.id}', '${k.status === 'active' ? 'disabled' : 'active'}')">${toggleActionText}</button>
                    <button class="btn btn-secondary btn-sm" onclick="window.adminApp.openRotate('${k.id}')">Rotate</button>
                    <button class="btn btn-danger btn-sm" onclick="window.adminApp.openRevoke('${k.id}')">Revoke</button>
                  `
                      : '<span style="font-size: 0.75rem; color: var(--text-muted);">Revoked</span>'
                  }
                </div>
              </td>
            </tr>
          `;
        })
        .join('');
    } catch (err) {
      console.error('Failed to load keys:', err);
    }
  }

  // Filter & Search listeners
  let searchTimeout = null;
  keysSearchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadKeys, 300);
  });
  keysStatusFilter.addEventListener('change', loadKeys);
  btnRefreshKeys.addEventListener('click', loadKeys);

  /**
   * Modal Management Helpers
   */
  function closeModal(modal) {
    if (modal) modal.hidden = true;
  }

  function openModal(modal) {
    if (modal) modal.hidden = false;
  }

  document.querySelectorAll('.btn-close-modal').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-backdrop').forEach(closeModal);
    });
  });

  // Open Create Modal buttons
  document.querySelectorAll('.btn-open-create-modal').forEach((btn) => {
    btn.addEventListener('click', () => {
      formCreateKey.reset();
      createKeyError.hidden = true;
      openModal(modalCreateKey);
      keyProjectName.focus();
    });
  });

  /**
   * Form Create Key Submit
   */
  formCreateKey.addEventListener('submit', async (e) => {
    e.preventDefault();
    createKeyError.hidden = true;

    const projectName = keyProjectName.value.trim();
    const description = keyDescription.value.trim();
    const expVal = keyExpiration.value;
    const rateLimitVal = keyRateLimit.value.trim();

    let expiresAt = null;
    if (expVal !== 'never') {
      const days = parseInt(expVal, 10);
      const d = new Date();
      d.setDate(d.getDate() + days);
      expiresAt = d.toISOString();
    }

    const rateLimitPerMinute = rateLimitVal ? parseInt(rateLimitVal, 10) : null;

    try {
      const { ok, data } = await apiFetch('/api/admin/keys', {
        method: 'POST',
        body: {
          projectName,
          description: description || undefined,
          expiresAt,
          rateLimitPerMinute,
        },
      });

      if (!ok || !data.success) {
        createKeyError.textContent = data.error?.message || 'Failed to generate API key.';
        createKeyError.hidden = false;
        return;
      }

      closeModal(modalCreateKey);
      // Reveal plaintext secret ONCE
      revealedSecretKey.textContent = data.key;
      openModal(modalSecretReveal);

      loadKeys();
      loadDashboardMetrics();
    } catch (err) {
      createKeyError.textContent = 'Network error while generating API key.';
      createKeyError.hidden = false;
    }
  });

  /**
   * Copy secret key to clipboard
   */
  btnCopySecret.addEventListener('click', async () => {
    const text = revealedSecretKey.textContent;
    try {
      await navigator.clipboard.writeText(text);
      const originalText = btnCopySecret.textContent;
      btnCopySecret.textContent = '✓ Copied to Clipboard!';
      setTimeout(() => {
        btnCopySecret.textContent = originalText;
      }, 2000);
    } catch {
      alert('Key copied: ' + text);
    }
  });

  btnCloseSecretReveal.addEventListener('click', () => {
    closeModal(modalSecretReveal);
  });

  /**
   * Toggle Status (Enable/Disable)
   */
  async function toggleStatus(id, newStatus) {
    try {
      const { ok, data } = await apiFetch(`/api/admin/keys/${id}`, {
        method: 'PATCH',
        body: { status: newStatus },
      });

      if (!ok) {
        alert(data.error?.message || 'Failed to update key status.');
        return;
      }

      loadKeys();
      loadDashboardMetrics();
    } catch {
      alert('Error updating API key status.');
    }
  }

  /**
   * Open Revoke Confirmation Modal
   */
  function openRevoke(id) {
    const key = currentKeys.find((k) => k.id === id);
    if (!key) return;

    pendingActionKey = key;
    revokeTargetProject.textContent = key.projectName;
    revokeTargetPrefix.textContent = key.keyPrefix;
    openModal(modalRevokeConfirm);
  }

  btnConfirmRevoke.addEventListener('click', async () => {
    if (!pendingActionKey) return;
    try {
      const { ok, data } = await apiFetch(`/api/admin/keys/${pendingActionKey.id}/revoke`, {
        method: 'POST',
      });

      if (!ok) {
        alert(data.error?.message || 'Failed to revoke API key.');
        return;
      }

      closeModal(modalRevokeConfirm);
      pendingActionKey = null;
      loadKeys();
      loadDashboardMetrics();
    } catch {
      alert('Error revoking API key.');
    }
  });

  /**
   * Open Rotate Confirmation Modal
   */
  function openRotate(id) {
    const key = currentKeys.find((k) => k.id === id);
    if (!key) return;

    pendingActionKey = key;
    rotateTargetProject.textContent = key.projectName;
    openModal(modalRotateConfirm);
  }

  btnConfirmRotate.addEventListener('click', async () => {
    if (!pendingActionKey) return;
    try {
      const { ok, data } = await apiFetch(`/api/admin/keys/${pendingActionKey.id}/rotate`, {
        method: 'POST',
      });

      if (!ok || !data.success) {
        alert(data.error?.message || 'Failed to rotate API key.');
        return;
      }

      closeModal(modalRotateConfirm);
      pendingActionKey = null;

      // Reveal new plaintext secret
      revealedSecretKey.textContent = data.key;
      openModal(modalSecretReveal);

      loadKeys();
      loadDashboardMetrics();
    } catch {
      alert('Error rotating API key.');
    }
  });

  /**
   * Open Key Details & Usage Logs
   */
  async function openDetails(id) {
    let key = currentKeys.find((k) => k.id === id);
    if (!key) {
      const { ok, data } = await apiFetch(`/api/admin/keys/${id}`);
      if (ok && data.key) key = data.key;
    }
    if (!key) return;

    detailsMetadataContent.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; background: var(--bg-base); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border);">
        <div>
          <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">PROJECT NAME</span>
          <strong style="color: var(--text-primary); font-size: 0.9375rem;">${escapeHtml(key.projectName)}</strong>
        </div>
        <div>
          <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">KEY IDENTIFIER</span>
          <code class="font-mono" style="color: #38bdf8;">${escapeHtml(key.keyPrefix)}</code>
        </div>
        <div>
          <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">STATUS</span>
          ${renderStatusBadge(key.status, key.expiresAt)}
        </div>
        <div>
          <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">RATE LIMIT</span>
          <span>${key.rateLimitPerMinute ? `${key.rateLimitPerMinute} req/min` : 'Global limit'}</span>
        </div>
        <div>
          <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">CREATED</span>
          <span>${formatDate(key.createdAt)}</span>
        </div>
        <div>
          <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">EXPIRES</span>
          <span>${key.expiresAt ? formatDate(key.expiresAt) : 'Never'}</span>
        </div>
        <div style="grid-column: span 2;">
          <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">TOTAL USAGE</span>
          <span><strong>${key.totalRequests}</strong> total requests (${key.successfulRequests} successful, ${key.failedRequests} failed)</span>
        </div>
      </div>
    `;

    detailsUsageTbody.innerHTML = `<tr><td colspan="5" class="empty-state">Loading usage logs...</td></tr>`;
    openModal(modalKeyDetails);

    // Fetch usage logs
    try {
      const { ok, data } = await apiFetch(`/api/admin/keys/${id}/usage?limit=50`);
      if (!ok || !data.usage || data.usage.length === 0) {
        detailsUsageTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No requests recorded yet for this key.</td></tr>`;
        return;
      }

      detailsUsageTbody.innerHTML = data.usage
        .map((u) => {
          const statusClass = u.statusCode >= 200 && u.statusCode < 400 ? 'color: #34d399;' : 'color: #f87171;';
          return `
            <tr>
              <td>${formatDate(u.timestamp)}</td>
              <td><code class="font-mono">${escapeHtml(u.endpoint)}</code></td>
              <td><strong style="${statusClass}">${u.statusCode}</strong></td>
              <td>${u.responseTimeMs} ms</td>
              <td>${escapeHtml(u.ipAddress || '—')}</td>
            </tr>
          `;
        })
        .join('');
    } catch {
      detailsUsageTbody.innerHTML = `<tr><td colspan="5" class="empty-state">Failed to load request logs.</td></tr>`;
    }
  }

  /**
   * HTML escape helper to prevent XSS
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Expose global methods for inline HTML onclick handlers
  window.adminApp = {
    openDetails,
    toggleStatus,
    openRevoke,
    openRotate,
  };

  // Run on startup
  checkSession();
})();
