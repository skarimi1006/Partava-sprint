// PEAVA Platform — Core JS
// API client, session guard, panel loader, notifications, localization

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------
var api = {
  _handle: function(res) {
    if (res.status === 401) { window.location.href = '/'; return null; }
    return res.json();
  },
  get: function(path) {
    return fetch(path).then(api._handle);
  },
  post: function(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(api._handle);
  },
  put: function(path, body) {
    return fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(api._handle);
  },
  del: function(path) {
    return fetch(path, { method: 'DELETE' }).then(api._handle);
  },
  postForm: function(path, formData) {
    return fetch(path, { method: 'POST', body: formData }).then(api._handle);
  }
};

// ---------------------------------------------------------------------------
// Session guard (call on app.html load)
// ---------------------------------------------------------------------------
var currentUser = null;

function initSession(cb) {
  api.get('/api/me').then(function(data) {
    if (!data || !data.ok) { window.location.href = '/'; return; }
    currentUser = data.data;
    if (typeof cb === 'function') cb(currentUser);
  }).catch(function() { window.location.href = '/'; });
}

// ---------------------------------------------------------------------------
// Panel loader — fetches module HTML fragment and injects into #panel
// ---------------------------------------------------------------------------
var _panelCache = {};

function loadPanel(moduleName) {
  var panel = document.getElementById('panel');
  if (!panel) return;

  // Mark nav active
  document.querySelectorAll('.nav-item').forEach(function(el) {
    el.classList.toggle('active', el.dataset.module === moduleName);
  });

  // Update topbar title
  var titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = MODULE_NAMES[moduleName] || moduleName;

  // Load panel HTML (cached)
  if (_panelCache[moduleName]) {
    panel.innerHTML = _panelCache[moduleName];
    _loadPanelScript(moduleName, function() { initPanelScripts(moduleName); });
    return;
  }

  panel.innerHTML = '<div style="padding:40px;text-align:center"><div class="spinner" style="margin:0 auto"></div></div>';

  fetch('/modules/' + moduleName + '/panel.html')
    .then(function(r) {
      if (!r.ok) throw new Error('Panel not found');
      return r.text();
    })
    .then(function(html) {
      _panelCache[moduleName] = html;
      panel.innerHTML = html;
      // Load module panel.js once, then init
      _loadPanelScript(moduleName, function() {
        initPanelScripts(moduleName);
      });
    })
    .catch(function() {
      panel.innerHTML = '<div class="empty-state"><div class="icon">🚧</div><p>Module coming soon</p></div>';
    });
}

// Load panel.js for a module once (browser caches subsequent requests)
function _loadPanelScript(moduleName, cb) {
  var scriptId = 'panel-js-' + moduleName;
  if (document.getElementById(scriptId)) {
    // Already loaded
    if (typeof cb === 'function') cb();
    return;
  }
  var s   = document.createElement('script');
  s.id    = scriptId;
  s.src   = '/modules/' + moduleName + '/panel.js';
  s.onload  = function() { if (typeof cb === 'function') cb(); };
  s.onerror = function() { if (typeof cb === 'function') cb(); };  // still init even if no JS
  document.head.appendChild(s);
}

// Trigger module init function if it exists (e.g. window.initSprint)
function initPanelScripts(moduleName) {
  var fnName = 'init' + moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
  if (typeof window[fnName] === 'function') window[fnName]();
}

// Module display names (en + fa)
var MODULE_NAMES = {
  sprint:      'Sprint Board',
  assets:      'Asset Inventory',
  qc:          'QC Tests',
  issues:      'Issues',
  deployments: 'Deployments',
  delivery:    'Delivery Letters',
  knowledge:   'Knowledge Base',
  reports:     'Reports & Analytics'
};
var MODULE_NAMES_FA = {
  sprint:      'تابلوی اسپرینت',
  assets:      'انبار تجهیزات',
  qc:          'آزمون QC',
  issues:      'مشکلات',
  deployments: 'استقرار',
  delivery:    'ارسال نسخه',
  knowledge:   'پایگاه دانش',
  reports:     'گزارش‌ها'
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
var _notifInterval = null;

function startNotifPolling() {
  fetchNotifCount();
  _notifInterval = setInterval(fetchNotifCount, 30000);
}

function fetchNotifCount() {
  api.get('/api/notifications/unread').then(function(data) {
    if (!data || !data.ok) return;
    var badge = document.getElementById('notif-badge');
    if (!badge) return;
    var count = data.data.count;
    badge.textContent  = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  });
}

function toggleNotifPanel() {
  var panel = document.getElementById('notif-panel');
  if (!panel) return;
  var isOpen = panel.classList.toggle('open');
  if (isOpen) loadNotifications();
}

function loadNotifications() {
  api.get('/api/notifications').then(function(data) {
    if (!data || !data.ok) return;
    var list = document.getElementById('notif-list');
    if (!list) return;
    if (!data.data.length) {
      list.innerHTML = '<div class="empty-state" style="padding:20px"><p>No notifications</p></div>';
      return;
    }
    list.innerHTML = data.data.map(function(n) {
      return '<div class="notif-item' + (n.read ? '' : ' unread') + '" onclick="readNotif(\'' + n.id + '\',this)">' +
        '<div class="notif-title">' + esc(n.title) + '</div>' +
        '<div class="notif-meta">' + esc(n.module) + ' · ' + timeAgo(n.created_at) + '</div>' +
        '</div>';
    }).join('');
  });
}

function readNotif(id, el) {
  api.post('/api/notifications/' + id + '/read').then(function() {
    el.classList.remove('unread');
    fetchNotifCount();
  });
}

// ---------------------------------------------------------------------------
// Localization
// ---------------------------------------------------------------------------
var _lang = localStorage.getItem('peava_lang') || 'en';

function t(key) {
  var map = _lang === 'fa' ? T_FA : T_EN;
  return map[key] || key;
}

function toggleLang() {
  _lang = _lang === 'en' ? 'fa' : 'en';
  localStorage.setItem('peava_lang', _lang);
  document.documentElement.setAttribute('dir', _lang === 'fa' ? 'rtl' : 'ltr');
  document.documentElement.setAttribute('lang', _lang);
  _panelCache = {};  // clear panel cache so panels re-render in new lang
  location.reload();
}

// Core translation strings
var T_EN = {
  save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit',
  add: 'Add', search: 'Search…', loading: 'Loading…',
  confirm_delete: 'Are you sure you want to delete this?',
  logout: 'Logout', settings: 'Settings'
};
var T_FA = {
  save: 'ذخیره', cancel: 'انصراف', delete: 'حذف', edit: 'ویرایش',
  add: 'افزودن', search: 'جستجو…', loading: 'در حال بارگذاری…',
  confirm_delete: 'آیا مطمئن هستید که می‌خواهید حذف کنید؟',
  logout: 'خروج', settings: 'تنظیمات'
};

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------
function toast(message, type) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var el = document.createElement('div');
  el.className = 'toast ' + (type || 'info');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(function() { el.remove(); }, 3500);
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

// HTML escape
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Time ago
function timeAgo(ts) {
  var diff = Date.now() - ts;
  var m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return m + ' min ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + ' hr ago';
  var d = Math.floor(h / 24);
  if (d < 7)  return d + ' days ago';
  return new Date(ts).toLocaleDateString();
}

// Task age CSS class
function ageClass(updatedAt) {
  var days = (Date.now() - updatedAt) / 86400000;
  if (days < 2) return 'age-fresh';
  if (days < 5) return 'age-mid';
  return 'age-old';
}

// Priority badge class
function priorityBadge(p) {
  var map = { Critical:'badge-critical', High:'badge-high', Medium:'badge-medium', Low:'badge-low' };
  return map[p] || 'badge-low';
}

// Status badge class
function statusBadge(s) {
  var map = {
    'To Do':'badge-todo', 'In Progress':'badge-progress', 'Done':'badge-done',
    'Open':'badge-open', 'In Progress':'badge-progress', 'Resolved':'badge-resolved',
    'Closed':'badge-closed', 'Rejected':'badge-low'
  };
  return map[s] || 'badge-todo';
}

// Close notif panel when clicking outside
document.addEventListener('click', function(e) {
  var panel = document.getElementById('notif-panel');
  var btn   = document.getElementById('notif-btn');
  if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
    panel.classList.remove('open');
  }
});
