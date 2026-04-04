'use strict';
// Sprint Panel — Client-side JS
// Entry point: window.initSprint() called by core.js on each panel activation

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var sprintState = {
  tasks:       [],
  users:       [],
  customers:   [],
  filters:     { member: '', status: '', priority: '', category: '' },
  selectedIds: new Set(),
  searchMode:  false,
  searchResults: [],
  activeTab:   'tasks',
  editingId:   null,
  kanbanCompact: false,
  commentTaskId: null,
  _searchTimer: null
};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
window.initSprint = function() {
  sprintState.tasks       = [];
  sprintState.selectedIds = new Set();
  sprintState.editingId   = null;
  sprintState.searchMode  = false;
  sprintState.activeTab   = 'tasks';

  // Show admin-only elements
  var btnReset = document.getElementById('btn-reset-sprint');
  if (btnReset && currentUser && currentUser.role === 'admin') {
    btnReset.style.display = '';
  }

  Promise.all([
    api.get('/api/users'),
    api.get('/api/sprint/customers')
  ]).then(function(results) {
    var usersRes = results[0];
    var custRes  = results[1];
    sprintState.users     = (usersRes  && usersRes.data)  ? usersRes.data  : [];
    sprintState.customers = (custRes   && custRes.data)   ? custRes.data   : [];
    _populateModalSelects();
    return api.get('/api/sprint/tasks');
  }).then(function(res) {
    if (res && res.data) sprintState.tasks = res.data;
    sprintRenderSummary();
    sprintRenderFilters();
    sprintRenderTable();
  }).catch(function(err) {
    console.error('Sprint init error', err);
    toast('Failed to load sprint data', 'error');
  });
};

// ---------------------------------------------------------------------------
// Populate modal dropdowns
// ---------------------------------------------------------------------------
function _populateModalSelects() {
  var selUser = document.getElementById('f_assigned_to');
  if (selUser) {
    selUser.innerHTML = '<option value="">— Unassigned —</option>';
    sprintState.users.forEach(function(u) {
      var opt = document.createElement('option');
      opt.value       = u.id;
      opt.textContent = u.full_name;
      selUser.appendChild(opt);
    });
  }

  var selCust = document.getElementById('f_customer_id');
  if (selCust) {
    selCust.innerHTML = '<option value="">— None —</option>';
    sprintState.customers.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value       = c.id;
      opt.textContent = c.full_name;
      selCust.appendChild(opt);
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers: filtered / searched task list
// ---------------------------------------------------------------------------
function _activeTasks() {
  var list = sprintState.searchMode ? sprintState.searchResults : sprintState.tasks;
  var f    = sprintState.filters;
  return list.filter(function(t) {
    if (f.member   && t.assigned_to !== f.member)   return false;
    if (f.status   && t.status      !== f.status)   return false;
    if (f.priority && t.priority    !== f.priority) return false;
    if (f.category && t.category    !== f.category) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Summary bar
// ---------------------------------------------------------------------------
function sprintRenderSummary() {
  var tasks = sprintState.tasks;
  var total    = tasks.length;
  var todo     = tasks.filter(function(t) { return t.status === 'To Do'; }).length;
  var inProg   = tasks.filter(function(t) { return t.status === 'In Progress'; }).length;
  var done     = tasks.filter(function(t) { return t.status === 'Done'; }).length;
  var critical = tasks.filter(function(t) { return t.priority === 'Critical'; }).length;
  var high     = tasks.filter(function(t) { return t.priority === 'High'; }).length;

  var bar = document.getElementById('sprint-summary');
  if (!bar) return;
  bar.innerHTML = [
    _kpi('Total',       total,    '',        'Tasks in sprint'),
    _kpi('Critical',    critical, 'c-danger','Priority: Critical'),
    _kpi('High',        high,     'c-warn',  'Priority: High'),
    _kpi('In Progress', inProg,   'c-teal',  'Currently active'),
    _kpi('Done',        done,     'c-green', 'Completed this sprint'),
    _kpi('To Do',       todo,     'c-blue',  'Not started'),
  ].join('');
}

function _kpi(label, val, cls, sub) {
  return '<div class="sprint-kpi ' + (cls || '') + '">' +
    '<div class="sk-label">' + esc(label) + '</div>' +
    '<div class="sk-val">'   + esc(val)   + '</div>' +
    '<div class="sk-sub">'   + esc(sub)   + '</div>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------
function sprintRenderFilters() {
  var container = document.getElementById('sprint-filters');
  if (!container) return;

  var members = [];
  var seen = {};
  sprintState.tasks.forEach(function(t) {
    if (t.assigned_to && !seen[t.assigned_to]) {
      seen[t.assigned_to] = 1;
      members.push({ id: t.assigned_to, name: t.assigned_name || t.assigned_to });
    }
  });

  var html = '';
  // Member chips
  members.forEach(function(m) {
    var active = sprintState.filters.member === m.id;
    html += '<button class="badge ' + (active ? 'badge-active' : '') + '" ' +
      'onclick="sprintFilter(\'member\',\'' + esc(m.id) + '\')">' + esc(m.name) + '</button>';
  });
  // Status chips
  ['To Do','In Progress','Done'].forEach(function(s) {
    var active = sprintState.filters.status === s;
    html += '<button class="badge ' + (active ? 'badge-active' : '') + '" ' +
      'onclick="sprintFilter(\'status\',\'' + esc(s) + '\')">' + esc(s) + '</button>';
  });
  // Priority chips
  ['Critical','High','Medium','Low'].forEach(function(p) {
    var active = sprintState.filters.priority === p;
    html += '<button class="badge ' + (active ? priorityBadge(p) + ' badge-active' : priorityBadge(p)) + '" ' +
      'onclick="sprintFilter(\'priority\',\'' + esc(p) + '\')">' + esc(p) + '</button>';
  });

  container.innerHTML = html;
}

function sprintFilter(key, val) {
  // Toggle off if already selected
  if (sprintState.filters[key] === val) {
    sprintState.filters[key] = '';
  } else {
    sprintState.filters[key] = val;
  }
  sprintRenderFilters();
  sprintRenderTable();
  if (sprintState.activeTab === 'kanban') sprintRenderKanban();
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------
function sprintTab(el, name) {
  document.querySelectorAll('#sprint-tabs .tab').forEach(function(t) {
    t.classList.remove('active');
  });
  if (el) el.classList.add('active');

  ['tasks','kanban','analysis','archive'].forEach(function(tab) {
    var el = document.getElementById('tab-' + tab);
    if (el) el.style.display = tab === name ? '' : 'none';
  });

  sprintState.activeTab = name;

  if (name === 'kanban')   sprintRenderKanban();
  if (name === 'analysis') sprintRenderAnalysis();
  if (name === 'archive')  sprintRenderArchive();
}

// ---------------------------------------------------------------------------
// TASKS TAB — Table
// ---------------------------------------------------------------------------
function sprintRenderTable() {
  var tasks  = _activeTasks();
  var tbody  = document.getElementById('sprint-tbody');
  var empty  = document.getElementById('sprint-empty');
  if (!tbody) return;

  if (!tasks.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = tasks.map(function(t, i) {
    var checked   = sprintState.selectedIds.has(t.id) ? 'checked' : '';
    var ageDays   = Math.floor((Date.now() - t.updated_at) / 86400000);
    var ageLabel  = ageDays < 1 ? 'today' : ageDays + 'd';
    var ageCls    = ageClass(t.updated_at);
    var pct       = parseInt(t.pct) || 0;
    var assignee  = t.assigned_name ? esc(t.assigned_name) : '<span class="muted">—</span>';
    var custName  = t.customer_name ? esc(t.customer_name) : '—';
    var doneDateLabel = t.done_date_shamsi ? esc(t.done_date_shamsi) : '—';

    return '<tr class="' + (sprintState.selectedIds.has(t.id) ? 'row-selected' : '') + '">' +
      '<td><input type="checkbox" class="checkbox" ' + checked + ' onchange="sprintSelectRow(\'' + esc(t.id) + '\',this)"></td>' +
      '<td>' + (i+1) + '</td>' +
      '<td>' + assignee + '</td>' +
      '<td>' +
        '<div class="task-title">' + esc(t.title) + '</div>' +
        '<div class="task-meta">' + esc(t.category) + (t.version ? ' · ' + esc(t.version) : '') + '</div>' +
        '<div class="pct-bar"><div class="pct-fill" style="width:' + pct + '%"></div></div>' +
      '</td>' +
      '<td class="hide-mobile">' + custName + '</td>' +
      '<td class="hide-mobile">' + esc(t.version || '—') + '</td>' +
      '<td class="hide-mobile"><span class="badge">' + esc(t.category) + '</span></td>' +
      '<td><span class="badge ' + priorityBadge(t.priority) + '">' +
        '<span class="pri-dot ' + t.priority.toLowerCase() + '"></span>' + esc(t.priority) +
      '</span></td>' +
      '<td><span class="badge ' + statusBadge(t.status) + '">' + esc(t.status) + '</span></td>' +
      '<td class="hide-mobile"><span class="' + ageCls + '">' + ageLabel + '</span></td>' +
      '<td class="hide-mobile">' + esc(t.pct) + '</td>' +
      '<td class="col-actions">' +
        '<button class="btn btn-xs" onclick="sprintOpenModal(\'' + esc(t.id) + '\')">Edit</button> ' +
        '<button class="btn btn-xs" onclick="sprintDuplicate(\'' + esc(t.id) + '\')">Dup</button> ' +
        '<button class="btn btn-xs" onclick="sprintOpenComments(\'' + esc(t.id) + '\')" title="Comments">💬</button> ' +
        (currentUser && currentUser.role === 'admin'
          ? '<button class="btn btn-xs" onclick="sprintForceArchive(\'' + esc(t.id) + '\')" title="Archive">📦</button> '
          : '') +
        '<button class="btn btn-xs btn-danger" onclick="sprintDelete(\'' + esc(t.id) + '\')">Del</button>' +
      '</td>' +
      '</tr>';
  }).join('');
}

// ---------------------------------------------------------------------------
// Checkbox / Bulk selection
// ---------------------------------------------------------------------------
function sprintSelectRow(id, chk) {
  if (chk.checked) {
    sprintState.selectedIds.add(id);
  } else {
    sprintState.selectedIds.delete(id);
  }
  _updateBulkBar();
}

function sprintSelectAll(chk) {
  var tasks = _activeTasks();
  if (chk.checked) {
    tasks.forEach(function(t) { sprintState.selectedIds.add(t.id); });
  } else {
    sprintState.selectedIds.clear();
  }
  sprintRenderTable();
  _updateBulkBar();
}

function _updateBulkBar() {
  var bar   = document.getElementById('sprint-bulk-bar');
  var count = document.getElementById('sprint-bulk-count');
  var n     = sprintState.selectedIds.size;
  if (bar)   bar.style.display = n > 0 ? '' : 'none';
  if (count) count.textContent = n + ' selected';
}

function sprintClearSelection() {
  sprintState.selectedIds.clear();
  var chkAll = document.getElementById('sprint-chk-all');
  if (chkAll) chkAll.checked = false;
  sprintRenderTable();
  _updateBulkBar();
}

function sprintBulkApply() {
  var ids      = Array.from(sprintState.selectedIds);
  var statusEl = document.getElementById('bulk-status-sel');
  var priorEl  = document.getElementById('bulk-priority-sel');
  if (!ids.length) return;

  var body = { ids: ids };
  if (statusEl && statusEl.value) body.status   = statusEl.value;
  if (priorEl  && priorEl.value)  body.priority = priorEl.value;
  if (!body.status && !body.priority) { toast('Select a status or priority to apply', 'warning'); return; }

  api.post('/api/sprint/tasks/bulk', body).then(function(res) {
    if (!res || !res.ok) { toast('Bulk update failed', 'error'); return; }
    toast('Updated ' + res.data.updated + ' task(s)', 'success');
    sprintClearSelection();
    _reloadTasks();
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function sprintSearch(q) {
  clearTimeout(sprintState._searchTimer);
  if (!q.trim()) {
    sprintState.searchMode    = false;
    sprintState.searchResults = [];
    sprintRenderTable();
    return;
  }
  sprintState._searchTimer = setTimeout(function() {
    api.get('/api/sprint/tasks/search?q=' + encodeURIComponent(q)).then(function(res) {
      sprintState.searchMode    = true;
      sprintState.searchResults = (res && res.data) ? res.data : [];
      sprintRenderTable();
    });
  }, 300);
}

// ---------------------------------------------------------------------------
// KANBAN TAB
// ---------------------------------------------------------------------------
function sprintRenderKanban() {
  var board = document.getElementById('kanban-board');
  if (!board) return;

  var tasks   = _activeTasks();
  var columns = [
    { key: 'To Do',       label: 'To Do',       cls: '' },
    { key: 'In Progress', label: 'In Progress',  cls: '' },
    { key: 'Done',        label: 'Done',         cls: '' }
  ];

  board.innerHTML = columns.map(function(col) {
    var colTasks = tasks.filter(function(t) { return t.status === col.key; });
    var cards    = colTasks.map(function(t) {
      var ageDays  = Math.floor((Date.now() - t.updated_at) / 86400000);
      var ageLabel = ageDays < 1 ? 'today' : ageDays + 'd';
      var pct      = parseInt(t.pct) || 0;
      return '<div class="kcard pri-' + esc(t.priority) + '" onclick="sprintOpenModal(\'' + esc(t.id) + '\')">' +
        '<div class="kcard-title">' + esc(t.title) + '</div>' +
        '<div class="kcard-meta">' +
          (t.assigned_name ? '<span class="badge">' + esc(t.assigned_name) + '</span>' : '') +
          (t.customer_name ? '<span class="badge">' + esc(t.customer_name) + '</span>' : '') +
          '<span class="badge ' + priorityBadge(t.priority) + '">' + esc(t.priority) + '</span>' +
          '<span class="badge">' + esc(t.category) + '</span>' +
          '<span class="badge age-badge">' + ageLabel + '</span>' +
        '</div>' +
        '<div class="pct-bar" style="margin-top:6px"><div class="pct-fill" style="width:' + pct + '%"></div></div>' +
        '</div>';
    }).join('');

    return '<div class="kanban-col' + (sprintState.kanbanCompact ? ' kanban-compact' : '') + '">' +
      '<div class="kanban-col-head">' +
        '<span>' + esc(col.label) + '</span>' +
        '<span class="kcol-count">' + colTasks.length + '</span>' +
      '</div>' +
      '<div class="kanban-body">' + (cards || '<div class="muted" style="font-size:.8rem;padding:10px">No tasks</div>') + '</div>' +
      '</div>';
  }).join('');
}

function sprintToggleCompact() {
  sprintState.kanbanCompact = !sprintState.kanbanCompact;
  var btn = document.getElementById('btn-kanban-compact');
  if (btn) btn.textContent = sprintState.kanbanCompact ? 'Full View' : 'Compact View';
  sprintRenderKanban();
}

// ---------------------------------------------------------------------------
// ANALYSIS TAB
// ---------------------------------------------------------------------------
function sprintRenderAnalysis() {
  _renderAnalysisKpi();
  api.get('/api/sprint/today-hours').then(function(res) {
    var todayData = (res && res.data) ? res.data : { members: [], total: 0 };
    _renderAnalysisGrid(todayData);
  });
}

function _renderAnalysisKpi() {
  var tasks    = sprintState.tasks;
  var total    = tasks.length;
  var todo     = tasks.filter(function(t) { return t.status === 'To Do'; }).length;
  var inProg   = tasks.filter(function(t) { return t.status === 'In Progress'; }).length;
  var done     = tasks.filter(function(t) { return t.status === 'Done'; }).length;
  var critical = tasks.filter(function(t) { return t.priority === 'Critical'; }).length;
  var high     = tasks.filter(function(t) { return t.priority === 'High'; }).length;

  var kpiEl = document.getElementById('analysis-kpi');
  if (!kpiEl) return;
  kpiEl.innerHTML = [
    _kpi('Total',       total,    '',        'Sprint tasks'),
    _kpi('To Do',       todo,     'c-blue',  ''),
    _kpi('In Progress', inProg,   'c-teal',  ''),
    _kpi('Done',        done,     'c-green', ''),
    _kpi('Critical',    critical, 'c-danger',''),
    _kpi('High',        high,     'c-warn',  ''),
  ].join('');
}

function _renderAnalysisGrid(todayData) {
  var tasks  = sprintState.tasks;
  var grid   = document.getElementById('analysis-grid');
  if (!grid) return;

  // 1. Workload by member
  var memberMap = {};
  tasks.forEach(function(t) {
    var key  = t.assigned_name || '(Unassigned)';
    memberMap[key] = (memberMap[key] || 0) + 1;
  });
  var memberHtml = _barChart(memberMap, tasks.length, 'Workload by Member');

  // 2. By Category
  var catMap = {};
  tasks.forEach(function(t) { catMap[t.category] = (catMap[t.category] || 0) + 1; });
  var catHtml = _barChart(catMap, tasks.length, 'By Category');

  // 3. By Priority
  var priMap   = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  var priColors = { Critical: 'var(--danger)', High: 'var(--warning)', Medium: 'var(--blue)', Low: 'var(--muted)' };
  tasks.forEach(function(t) { if (priMap[t.priority] !== undefined) priMap[t.priority]++; });
  var priHtml = '<div class="analysis-card"><h4>By Priority</h4>';
  Object.keys(priMap).forEach(function(p) {
    priHtml += '<div class="pri-row">' +
      '<span class="pri-dot ' + p.toLowerCase() + '"></span>' +
      '<span style="flex:1;font-size:.82rem">' + esc(p) + '</span>' +
      '<span style="font-weight:600;color:' + priColors[p] + '">' + priMap[p] + '</span>' +
      '</div>';
  });
  priHtml += '</div>';

  // 4. By Customer
  var custMap = {};
  tasks.forEach(function(t) {
    if (t.customer_name) custMap[t.customer_name] = (custMap[t.customer_name] || 0) + 1;
  });
  var custHtml = _barChart(custMap, tasks.length, 'By Customer');

  // 5. Today — Time Spent
  var todayHtml = '<div class="analysis-card"><h4>Today — Time Spent</h4>';
  if (todayData.members && todayData.members.length) {
    var maxH = Math.max.apply(null, todayData.members.map(function(m) { return m.hours; }));
    todayData.members.forEach(function(m) {
      var pct = maxH > 0 ? Math.round((m.hours / maxH) * 100) : 0;
      todayHtml += '<div class="bar-row">' +
        '<span class="bar-label">' + esc(m.name) + '</span>' +
        '<div class="bar-wrap"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="bar-count">' + m.hours + 'h</span>' +
        '</div>';
    });
    todayHtml += '<div style="margin-top:8px;font-size:.78rem;color:var(--muted)">Total: <strong>' + todayData.total + 'h</strong></div>';
  } else {
    todayHtml += '<p class="archive-note">No hours logged today.</p>';
  }
  todayHtml += '</div>';

  grid.innerHTML = memberHtml + catHtml + priHtml + custHtml + todayHtml;
}

function _barChart(map, total, title) {
  var keys = Object.keys(map).sort(function(a, b) { return map[b] - map[a]; });
  if (!keys.length) return '<div class="analysis-card"><h4>' + esc(title) + '</h4><p class="archive-note">No data</p></div>';
  var max  = map[keys[0]] || 1;
  var rows = keys.map(function(k) {
    var cnt = map[k];
    var w   = Math.round((cnt / max) * 100);
    var pct = total > 0 ? Math.round((cnt / total) * 100) : 0;
    return '<div class="bar-row">' +
      '<span class="bar-label">' + esc(k) + '</span>' +
      '<div class="bar-wrap"><div class="bar-fill" style="width:' + w + '%"></div></div>' +
      '<span class="bar-count">' + cnt + '</span>' +
      '<span class="bar-pct">' + pct + '%</span>' +
      '</div>';
  }).join('');
  return '<div class="analysis-card"><h4>' + esc(title) + '</h4>' + rows + '</div>';
}

// ---------------------------------------------------------------------------
// ARCHIVE TAB
// ---------------------------------------------------------------------------
function sprintRenderArchive() {
  api.get('/api/sprint/tasks/archive').then(function(res) {
    var tasks  = (res && res.data) ? res.data : [];
    var tbody  = document.getElementById('archive-tbody');
    var empty  = document.getElementById('archive-empty');
    if (!tbody) return;

    if (!tasks.length) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    tbody.innerHTML = tasks.map(function(t, i) {
      var archivedDate = t.archived_at ? new Date(t.archived_at).toISOString().split('T')[0] : '—';
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td><div class="task-title">' + esc(t.title) + '</div>' +
          (t.assigned_name ? '<div class="task-meta">' + esc(t.assigned_name) + '</div>' : '') +
        '</td>' +
        '<td>' + esc(t.category) + '</td>' +
        '<td class="hide-mobile"><span class="badge ' + priorityBadge(t.priority) + '">' + esc(t.priority) + '</span></td>' +
        '<td class="hide-mobile">' + esc(t.done_date_shamsi || '—') + '</td>' +
        '<td>' + esc(archivedDate) + '</td>' +
        '</tr>';
    }).join('');
  });
}

// ---------------------------------------------------------------------------
// Task Modal
// ---------------------------------------------------------------------------
function sprintOpenModal(id) {
  sprintState.editingId = id || null;
  var modal   = document.getElementById('sprint-modal');
  var titleEl = document.getElementById('sprint-modal-title');
  if (!modal) return;

  _clearModalForm();

  if (id) {
    // Edit mode — find task
    var task = sprintState.tasks.find(function(t) { return t.id === id; });
    if (!task) { toast('Task not found', 'error'); return; }
    if (titleEl) titleEl.textContent = 'Edit Task';
    _fillModalForm(task);
  } else {
    if (titleEl) titleEl.textContent = 'New Task';
  }

  modal.style.display = 'flex';
}

function sprintCloseModal() {
  var modal = document.getElementById('sprint-modal');
  if (modal) modal.style.display = 'none';
  sprintState.editingId = null;
}

function _clearModalForm() {
  var fields = ['f_assigned_to','f_role','f_title','f_customer_id','f_version',
                'f_category','f_priority','f_status','f_pct',
                'f_done_date_shamsi','f_due_date_shamsi','f_notes','f_time_spend'];
  fields.forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') {
      el.selectedIndex = 0;
    } else {
      el.value = '';
    }
  });
}

function _fillModalForm(task) {
  _setVal('f_assigned_to',      task.assigned_to       || '');
  _setVal('f_role',             task.role              || '');
  _setVal('f_title',            task.title             || '');
  _setVal('f_customer_id',      task.customer_id       || '');
  _setVal('f_version',          task.version           || '');
  _setVal('f_category',         task.category          || 'Development');
  _setVal('f_priority',         task.priority          || 'Medium');
  _setVal('f_status',           task.status            || 'To Do');
  _setVal('f_pct',              task.pct               || '0%');
  _setVal('f_done_date_shamsi', task.done_date_shamsi  || '');
  _setVal('f_due_date_shamsi',  task.due_date          ? String(task.due_date) : '');
  _setVal('f_notes',            task.notes             || '');
  _setVal('f_time_spend',       task.time_spend        || '');
}

function _setVal(id, val) {
  var el = document.getElementById(id);
  if (el) el.value = val;
}

function sprintStatusChange(val) {
  if (val === 'Done') {
    var pctEl = document.getElementById('f_pct');
    if (pctEl) pctEl.value = '100%';
    // Auto-fill done date if empty (Shamsi today)
    var ddEl = document.getElementById('f_done_date_shamsi');
    if (ddEl && !ddEl.value && typeof toShamsi === 'function') {
      ddEl.value = toShamsi(new Date());
    }
  }
}

function sprintSaveTask() {
  var title = (document.getElementById('f_title') || {}).value || '';
  if (!title.trim()) { toast('Task description is required', 'error'); return; }

  var body = {
    title:            title.trim(),
    assigned_to:      _getVal('f_assigned_to')      || null,
    role:             _getVal('f_role')              || null,
    customer_id:      _getVal('f_customer_id')       || null,
    version:          _getVal('f_version')           || null,
    category:         _getVal('f_category')          || 'Development',
    priority:         _getVal('f_priority')          || 'Medium',
    status:           _getVal('f_status')            || 'To Do',
    pct:              _getVal('f_pct')               || '0%',
    done_date_shamsi: _getVal('f_done_date_shamsi')  || null,
    due_date:         _getVal('f_due_date_shamsi')   || null,
    notes:            _getVal('f_notes')             || null,
    time_spend:       parseFloat(_getVal('f_time_spend')) || 0,
  };

  var isEdit   = !!sprintState.editingId;
  var promise  = isEdit
    ? api.put('/api/sprint/tasks/' + sprintState.editingId, body)
    : api.post('/api/sprint/tasks', body);

  promise.then(function(res) {
    if (!res || !res.ok) {
      toast((res && res.error) || 'Save failed', 'error');
      return;
    }
    toast(isEdit ? 'Task updated' : 'Task created', 'success');
    sprintCloseModal();
    _reloadTasks();
  }).catch(function() {
    toast('Save failed', 'error');
  });
}

function _getVal(id) {
  var el = document.getElementById(id);
  return el ? el.value : '';
}

// ---------------------------------------------------------------------------
// Task actions
// ---------------------------------------------------------------------------
function sprintDelete(id) {
  if (!confirm('Delete this task?')) return;
  api.del('/api/sprint/tasks/' + id).then(function(res) {
    if (!res || !res.ok) { toast('Delete failed', 'error'); return; }
    toast('Task deleted', 'success');
    _removeTaskFromState(id);
    sprintRenderSummary();
    sprintRenderFilters();
    sprintRenderTable();
  });
}

function sprintDuplicate(id) {
  api.post('/api/sprint/tasks/' + id + '/duplicate', {}).then(function(res) {
    if (!res || !res.ok) { toast('Duplicate failed', 'error'); return; }
    toast('Task duplicated', 'success');
    sprintState.tasks.unshift(res.data);
    sprintRenderSummary();
    sprintRenderFilters();
    sprintRenderTable();
  });
}

function sprintForceArchive(id) {
  if (!confirm('Force-archive this task? It will move to the archive immediately.')) return;
  api.post('/api/sprint/tasks/' + id + '/archive', {}).then(function(res) {
    if (!res || !res.ok) { toast('Archive failed', 'error'); return; }
    toast('Task archived', 'success');
    _removeTaskFromState(id);
    sprintRenderSummary();
    sprintRenderFilters();
    sprintRenderTable();
  });
}

function _removeTaskFromState(id) {
  sprintState.tasks = sprintState.tasks.filter(function(t) { return t.id !== id; });
  sprintState.selectedIds.delete(id);
}

// ---------------------------------------------------------------------------
// Sprint Reset / Export
// ---------------------------------------------------------------------------
function sprintReset() {
  if (!confirm('Archive all DONE tasks and start a new sprint?\n\nNote: To Do and In Progress tasks will carry forward.')) return;
  api.post('/api/sprint/reset', {}).then(function(res) {
    if (!res || !res.ok) { toast('Reset failed', 'error'); return; }
    toast('Sprint reset — ' + res.data.archived + ' task(s) archived', 'success');
    _reloadTasks();
  });
}

function sprintExport() {
  window.location.href = '/api/sprint/export';
}

// ---------------------------------------------------------------------------
// Comments panel
// ---------------------------------------------------------------------------
function sprintOpenComments(taskId) {
  sprintState.commentTaskId = taskId;
  var task    = sprintState.tasks.find(function(t) { return t.id === taskId; });
  var titleEl = document.getElementById('sprint-comments-title');
  if (titleEl) titleEl.textContent = task ? ('Comments — ' + task.title.substring(0, 40)) : 'Comments';

  var panel = document.getElementById('sprint-comments');
  if (panel) panel.classList.add('open');

  _loadComments(taskId);
}

function sprintCloseComments() {
  var panel = document.getElementById('sprint-comments');
  if (panel) panel.classList.remove('open');
  sprintState.commentTaskId = null;
}

function _loadComments(taskId) {
  api.get('/api/sprint/tasks/' + taskId + '/comments').then(function(res) {
    var list = document.getElementById('sprint-comment-list');
    if (!list) return;
    var comments = (res && res.data) ? res.data : [];
    if (!comments.length) {
      list.innerHTML = '<div class="archive-note" style="padding:12px">No comments yet.</div>';
      return;
    }
    list.innerHTML = comments.map(function(c) {
      var d    = new Date(c.created_at);
      var date = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      var isMine = currentUser && c.user_id === currentUser.id;
      return '<div class="comment-item">' +
        '<div class="comment-meta">' +
          '<strong>' + esc(c.author_name) + '</strong>' +
          '<span class="muted">' + esc(date) + '</span>' +
          (isMine || (currentUser && currentUser.role === 'admin')
            ? '<button class="btn btn-xs" onclick="sprintDeleteComment(\'' + esc(c.task_id) + '\',\'' + esc(c.id) + '\')">✕</button>'
            : '') +
        '</div>' +
        '<div class="comment-body">' + esc(c.body) + '</div>' +
        '</div>';
    }).join('');
  });
}

function sprintSendComment() {
  var taskId = sprintState.commentTaskId;
  if (!taskId) return;
  var input = document.getElementById('sprint-comment-input');
  var body  = input ? input.value.trim() : '';
  if (!body) return;

  api.post('/api/sprint/tasks/' + taskId + '/comments', { body: body }).then(function(res) {
    if (!res || !res.ok) { toast('Failed to send comment', 'error'); return; }
    if (input) input.value = '';
    _loadComments(taskId);
  });
}

function sprintDeleteComment(taskId, cid) {
  if (!confirm('Delete this comment?')) return;
  api.del('/api/sprint/tasks/' + taskId + '/comments/' + cid).then(function(res) {
    if (!res || !res.ok) { toast('Failed to delete comment', 'error'); return; }
    _loadComments(taskId);
  });
}

// ---------------------------------------------------------------------------
// Reload tasks helper
// ---------------------------------------------------------------------------
function _reloadTasks() {
  api.get('/api/sprint/tasks').then(function(res) {
    if (res && res.data) sprintState.tasks = res.data;
    sprintRenderSummary();
    sprintRenderFilters();
    sprintRenderTable();
    if (sprintState.activeTab === 'kanban')   sprintRenderKanban();
    if (sprintState.activeTab === 'analysis') sprintRenderAnalysis();
  });
}
