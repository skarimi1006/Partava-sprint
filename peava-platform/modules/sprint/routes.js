'use strict';

const auth   = require('../../core/auth');
const perms  = require('../../core/permissions');
const audit  = require('../../core/audit');
const notif  = require('../../core/notifications');
const { toShamsi } = require('../../core/shamsi');
const { buildXlsx } = require('./xlsx');

// ---------------------------------------------------------------------------
// Helper: enrich tasks with joined names
// ---------------------------------------------------------------------------
function enrichTasks(db, rows) {
  return rows.map(function(t) {
    const user = t.assigned_to
      ? db.prepare('SELECT full_name FROM users WHERE id=?').get(t.assigned_to)
      : null;
    const cust = t.customer_id
      ? db.prepare('SELECT full_name FROM customers WHERE id=?').get(t.customer_id)
      : null;
    return Object.assign({}, t, {
      assigned_name: user ? user.full_name : null,
      customer_name: cust ? cust.full_name : null,
    });
  });
}

function getIp(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
}

// Priority sort order for ORDER BY emulation
const PRIORITY_ORDER = { Critical: 4, High: 3, Medium: 2, Low: 1 };

function sortTasks(tasks) {
  return tasks.sort(function(a, b) {
    const pa = PRIORITY_ORDER[a.priority] || 0;
    const pb = PRIORITY_ORDER[b.priority] || 0;
    if (pb !== pa) return pb - pa;
    return b.created_at - a.created_at;
  });
}

// ---------------------------------------------------------------------------
function register(router, db) {

  // ── GET /api/sprint/tasks ─────────────────────────────────────────────────
  router.get('/api/sprint/tasks', function(req, res) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;
    if (!perms.enforce(db, s, 'sprint', 'read', res)) return;

    let rows;
    if (s.role === 'admin') {
      const teamId = req.query.teamId;
      rows = teamId
        ? db.prepare("SELECT * FROM tasks WHERE archived=0 AND team_id=?").all(teamId)
        : db.prepare("SELECT * FROM tasks WHERE archived=0").all();
    } else {
      rows = db.prepare("SELECT * FROM tasks WHERE archived=0 AND team_id=?").all(s.team_id);
    }
    router.send(res, 200, { ok: true, data: sortTasks(enrichTasks(db, rows)) });
  });

  // ── POST /api/sprint/tasks ────────────────────────────────────────────────
  router.post('/api/sprint/tasks', function(req, res) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;
    if (!perms.enforce(db, s, 'sprint', 'write', res)) return;

    const b = req.body;
    if (!b.title || !String(b.title).trim()) {
      return router.send(res, 400, { ok: false, error: 'Title is required' });
    }

    const now    = Date.now();
    const id     = auth.genId();
    const teamId = (s.role === 'admin' && b.team_id) ? b.team_id : s.team_id;
    const status = b.status || 'To Do';
    const isDone = status === 'Done';

    db.prepare(`INSERT INTO tasks
      (id,title,category,priority,status,pct,role,assigned_to,team_id,customer_id,
       source_module,source_id,version,notes,time_spend,due_date,
       done_date,done_date_shamsi,archived,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`)
      .run(
        id,
        String(b.title).trim(),
        b.category    || 'Development',
        b.priority    || 'Medium',
        status,
        isDone ? '100%' : (b.pct || '0%'),
        b.role        || null,
        b.assigned_to || null,
        teamId,
        b.customer_id || null,
        b.source_module || null,
        b.source_id   || null,
        b.version     || null,
        b.notes       || null,
        parseFloat(b.time_spend) || 0,
        b.due_date    || null,
        isDone ? now  : null,
        isDone ? toShamsi(new Date()) : null,
        s.user_id, now, now
      );

    audit.log(db, s.user_id, 'create', 'sprint', id, { title: b.title }, getIp(req));

    // Notify assigned user if different from creator
    if (b.assigned_to && b.assigned_to !== s.user_id) {
      notif.notify(db, {
        userId: b.assigned_to, module: 'sprint', type: 'task_assigned',
        title: 'Task assigned to you',
        body:  String(b.title).substring(0, 80),
        recordId: id
      });
    }

    const created = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    router.send(res, 200, { ok: true, data: enrichTasks(db, [created])[0] });
  });

  // ── PUT /api/sprint/tasks/:id ─────────────────────────────────────────────
  router.put('/api/sprint/tasks/:id', function(req, res, params) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;
    if (!perms.enforce(db, s, 'sprint', 'write', res)) return;

    const task = db.prepare('SELECT * FROM tasks WHERE id=? AND archived=0').get(params.id);
    if (!task) return router.send(res, 404, { ok: false, error: 'Task not found' });
    if (s.role !== 'admin' && task.team_id !== s.team_id)
      return router.send(res, 403, { ok: false, error: 'Forbidden' });

    const b       = req.body;
    const now     = Date.now();
    const status  = b.status !== undefined ? b.status : task.status;
    const wasDone = task.status === 'Done';
    const isDone  = status === 'Done';

    const doneDate      = isDone ? (task.done_date      || now)               : null;
    const doneDateSh    = isDone ? (task.done_date_shamsi|| toShamsi(new Date())): null;
    const pct           = isDone ? '100%' : (b.pct !== undefined ? b.pct : task.pct);

    const changedFields = {};
    const fields = ['title','category','priority','status','pct','role','assigned_to','customer_id','version','notes','time_spend','due_date'];
    fields.forEach(function(f) {
      if (b[f] !== undefined && b[f] !== task[f]) changedFields[f] = { from: task[f], to: b[f] };
    });

    db.prepare(`UPDATE tasks SET
      title=?, category=?, priority=?, status=?, pct=?, role=?,
      assigned_to=?, customer_id=?, version=?, notes=?, time_spend=?,
      due_date=?, done_date=?, done_date_shamsi=?, updated_at=?
      WHERE id=?`)
      .run(
        b.title       !== undefined ? String(b.title).trim() : task.title,
        b.category    !== undefined ? b.category    : task.category,
        b.priority    !== undefined ? b.priority    : task.priority,
        status,
        pct,
        b.role        !== undefined ? b.role        : task.role,
        b.assigned_to !== undefined ? b.assigned_to : task.assigned_to,
        b.customer_id !== undefined ? b.customer_id : task.customer_id,
        b.version     !== undefined ? b.version     : task.version,
        b.notes       !== undefined ? b.notes       : task.notes,
        b.time_spend  !== undefined ? parseFloat(b.time_spend) : task.time_spend,
        b.due_date    !== undefined ? b.due_date    : task.due_date,
        doneDate,
        doneDateSh,
        now,
        params.id
      );

    if (Object.keys(changedFields).length)
      audit.log(db, s.user_id, 'update', 'sprint', params.id, changedFields, getIp(req));

    // Notify new assignee
    const newAssignee = b.assigned_to !== undefined ? b.assigned_to : task.assigned_to;
    if (b.assigned_to && b.assigned_to !== task.assigned_to && b.assigned_to !== s.user_id) {
      const taskTitle = b.title || task.title;
      notif.notify(db, {
        userId: b.assigned_to, module: 'sprint', type: 'task_assigned',
        title: 'Task assigned to you',
        body:  String(taskTitle).substring(0, 80),
        recordId: params.id
      });
    }

    const updated = db.prepare('SELECT * FROM tasks WHERE id=?').get(params.id);
    router.send(res, 200, { ok: true, data: enrichTasks(db, [updated])[0] });
  });

  // ── DELETE /api/sprint/tasks/:id ──────────────────────────────────────────
  router.del('/api/sprint/tasks/:id', function(req, res, params) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;
    if (!perms.enforce(db, s, 'sprint', 'delete', res)) return;

    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(params.id);
    if (!task) return router.send(res, 404, { ok: false, error: 'Task not found' });
    if (s.role !== 'admin' && task.team_id !== s.team_id)
      return router.send(res, 403, { ok: false, error: 'Forbidden' });

    db.prepare('DELETE FROM task_comments WHERE task_id=?').run(params.id);
    db.prepare('DELETE FROM tasks WHERE id=?').run(params.id);
    audit.log(db, s.user_id, 'delete', 'sprint', params.id, { title: task.title }, getIp(req));
    router.send(res, 200, { ok: true });
  });

  // ── POST /api/sprint/tasks/bulk ───────────────────────────────────────────
  router.post('/api/sprint/tasks/bulk', function(req, res) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;
    if (!perms.enforce(db, s, 'sprint', 'write', res)) return;

    const { ids, status, priority } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return router.send(res, 400, { ok: false, error: 'ids array required' });

    const now = Date.now();
    let updated = 0;

    for (const id of ids) {
      const task = db.prepare('SELECT * FROM tasks WHERE id=? AND archived=0').get(id);
      if (!task) continue;
      if (s.role !== 'admin' && task.team_id !== s.team_id) continue;

      const newStatus = status || task.status;
      const isDone    = newStatus === 'Done';
      const newPct    = isDone ? '100%' : (priority ? task.pct : task.pct);

      db.prepare(`UPDATE tasks SET
        status=?, priority=?, pct=?,
        done_date=?, done_date_shamsi=?, updated_at=?
        WHERE id=?`)
        .run(
          newStatus,
          priority || task.priority,
          newPct,
          isDone ? (task.done_date || now) : null,
          isDone ? (task.done_date_shamsi || toShamsi(new Date())) : null,
          now,
          id
        );

      audit.log(db, s.user_id, 'update', 'sprint', id,
        Object.assign({}, status ? { status } : {}, priority ? { priority } : {}),
        getIp(req));
      updated++;
    }

    router.send(res, 200, { ok: true, data: { updated } });
  });

  // ── POST /api/sprint/tasks/:id/duplicate ──────────────────────────────────
  router.post('/api/sprint/tasks/:id/duplicate', function(req, res, params) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;
    if (!perms.enforce(db, s, 'sprint', 'write', res)) return;

    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(params.id);
    if (!task) return router.send(res, 404, { ok: false, error: 'Task not found' });
    if (s.role !== 'admin' && task.team_id !== s.team_id)
      return router.send(res, 403, { ok: false, error: 'Forbidden' });

    const now   = Date.now();
    const newId = auth.genId();

    db.prepare(`INSERT INTO tasks
      (id,title,category,priority,status,pct,role,assigned_to,team_id,customer_id,
       source_module,source_id,version,notes,time_spend,due_date,
       done_date,done_date_shamsi,archived,created_by,created_at,updated_at)
      VALUES (?,?,?,?,'To Do','0%',?,?,?,?,?,?,?,?,0,?,?,?,0,?,?,?)`)
      .run(
        newId, task.title, task.category, task.priority,
        task.role, task.assigned_to, task.team_id, task.customer_id,
        task.source_module, task.source_id, task.version, task.notes,
        0, task.due_date, null, null,
        s.user_id, now, now
      );

    audit.log(db, s.user_id, 'create', 'sprint', newId, { duplicated_from: params.id }, getIp(req));
    const created = db.prepare('SELECT * FROM tasks WHERE id=?').get(newId);
    router.send(res, 200, { ok: true, data: enrichTasks(db, [created])[0] });
  });

  // ── GET /api/sprint/tasks/search ──────────────────────────────────────────
  router.get('/api/sprint/tasks/search', function(req, res) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;
    if (!perms.enforce(db, s, 'sprint', 'read', res)) return;

    const q = String(req.query.q || '').trim();
    if (!q) return router.send(res, 200, { ok: true, data: [] });

    const like = '%' + q + '%';
    let rows;
    const baseQ = `SELECT t.* FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.archived=0
        AND (t.title LIKE ? OR t.notes LIKE ? OR t.version LIKE ?
             OR u.full_name LIKE ? OR c.full_name LIKE ?)`;

    if (s.role === 'admin') {
      rows = db.prepare(baseQ).all(like, like, like, like, like);
    } else {
      rows = db.prepare(baseQ + ' AND t.team_id=?').all(like, like, like, like, like, s.team_id);
    }

    router.send(res, 200, { ok: true, data: sortTasks(enrichTasks(db, rows)) });
  });

  // ── GET /api/sprint/tasks/archive ─────────────────────────────────────────
  router.get('/api/sprint/tasks/archive', function(req, res) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;
    if (!perms.enforce(db, s, 'sprint', 'read', res)) return;

    let rows;
    if (s.role === 'admin') {
      rows = db.prepare("SELECT * FROM tasks WHERE archived=1 ORDER BY archived_at DESC LIMIT 200").all();
    } else {
      rows = db.prepare("SELECT * FROM tasks WHERE archived=1 AND team_id=? ORDER BY archived_at DESC LIMIT 200").all(s.team_id);
    }
    router.send(res, 200, { ok: true, data: enrichTasks(db, rows) });
  });

  // ── POST /api/sprint/tasks/:id/archive  (admin force-archive) ─────────────
  router.post('/api/sprint/tasks/:id/archive', function(req, res, params) {
    const s = auth.requireAdmin(req, res, db);
    if (!s) return;

    const now = Date.now();
    db.prepare("UPDATE tasks SET archived=1, archived_at=? WHERE id=?").run(now, params.id);
    audit.log(db, s.user_id, 'update', 'sprint', params.id, { archived: true }, getIp(req));
    router.send(res, 200, { ok: true });
  });

  // ── GET /api/sprint/tasks/:id/comments ────────────────────────────────────
  router.get('/api/sprint/tasks/:id/comments', function(req, res, params) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;

    const comments = db.prepare(`
      SELECT c.*, u.full_name as author_name
      FROM task_comments c JOIN users u ON u.id = c.user_id
      WHERE c.task_id=? ORDER BY c.created_at ASC
    `).all(params.id);
    router.send(res, 200, { ok: true, data: comments });
  });

  // ── POST /api/sprint/tasks/:id/comments ───────────────────────────────────
  router.post('/api/sprint/tasks/:id/comments', function(req, res, params) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;

    const body = String(req.body.body || '').trim();
    if (!body) return router.send(res, 400, { ok: false, error: 'Comment body required' });

    const id  = auth.genId();
    const now = Date.now();
    db.prepare('INSERT INTO task_comments (id,task_id,user_id,body,created_at) VALUES (?,?,?,?,?)')
      .run(id, params.id, s.user_id, body, now);

    const comment = db.prepare(`
      SELECT c.*, u.full_name as author_name
      FROM task_comments c JOIN users u ON u.id = c.user_id WHERE c.id=?
    `).get(id);
    router.send(res, 200, { ok: true, data: comment });
  });

  // ── DELETE /api/sprint/tasks/:id/comments/:cid ────────────────────────────
  router.del('/api/sprint/tasks/:id/comments/:cid', function(req, res, params) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;

    const comment = db.prepare('SELECT * FROM task_comments WHERE id=?').get(params.cid);
    if (!comment) return router.send(res, 404, { ok: false, error: 'Comment not found' });
    if (comment.user_id !== s.user_id && s.role !== 'admin')
      return router.send(res, 403, { ok: false, error: 'Forbidden' });

    db.prepare('DELETE FROM task_comments WHERE id=?').run(params.cid);
    router.send(res, 200, { ok: true });
  });

  // ── POST /api/sprint/reset  (admin) ───────────────────────────────────────
  router.post('/api/sprint/reset', function(req, res) {
    const s = auth.requireAdmin(req, res, db);
    if (!s) return;

    const now    = Date.now();
    const result = db.prepare(
      "UPDATE tasks SET archived=1, archived_at=? WHERE status='Done' AND archived=0"
    ).run(now);

    audit.log(db, s.user_id, 'sprint_reset', 'sprint', null,
      { archived: result.changes, carried_forward: 'To Do + In Progress tasks' }, getIp(req));

    router.send(res, 200, { ok: true, data: { archived: result.changes } });
  });

  // ── GET /api/sprint/export ────────────────────────────────────────────────
  router.get('/api/sprint/export', function(req, res) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;

    let tasks;
    if (s.role === 'admin') {
      tasks = db.prepare('SELECT * FROM tasks WHERE archived=0').all();
    } else {
      tasks = db.prepare('SELECT * FROM tasks WHERE archived=0 AND team_id=?').all(s.team_id);
    }
    const enriched = enrichTasks(db, tasks);
    const teams    = db.prepare('SELECT * FROM teams').all();
    const buf      = buildXlsx(enriched, teams);
    const fname    = 'sprint_tasks_' + new Date().toISOString().split('T')[0] + '.xlsx';

    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="' + fname + '"',
      'Content-Length': buf.length,
    });
    res.end(buf);
  });

  // ── GET /api/sprint/analytics ─────────────────────────────────────────────
  router.get('/api/sprint/analytics', function(req, res) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;

    const teams = db.prepare('SELECT * FROM teams').all();
    const data  = teams.map(function(team) {
      const total    = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived=0 AND team_id=?").get(team.id).c;
      const todo     = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived=0 AND team_id=? AND status='To Do'").get(team.id).c;
      const inProg   = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived=0 AND team_id=? AND status='In Progress'").get(team.id).c;
      const done     = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived=0 AND team_id=? AND status='Done'").get(team.id).c;
      const critical = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived=0 AND team_id=? AND priority='Critical'").get(team.id).c;
      const high     = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived=0 AND team_id=? AND priority='High'").get(team.id).c;
      return { team: team.name, color: team.color, id: team.id, total, todo, inProg, done, critical, high };
    });

    const overall = {
      total:    db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived=0").get().c,
      todo:     db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived=0 AND status='To Do'").get().c,
      inProg:   db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived=0 AND status='In Progress'").get().c,
      done:     db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived=0 AND status='Done'").get().c,
      critical: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived=0 AND priority='Critical'").get().c,
      high:     db.prepare("SELECT COUNT(*) as c FROM tasks WHERE archived=0 AND priority='High'").get().c,
    };

    router.send(res, 200, { ok: true, data: { overall, teams: data } });
  });

  // ── GET /api/sprint/today-hours ───────────────────────────────────────────
  router.get('/api/sprint/today-hours', function(req, res) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;

    const today = new Date().toISOString().split('T')[0];
    let rows;
    if (s.role === 'admin') {
      rows = db.prepare(`
        SELECT u.full_name as name, SUM(t.time_spend) as hours
        FROM tasks t JOIN users u ON u.id = t.assigned_to
        WHERE t.time_spend > 0
          AND date(t.updated_at/1000, 'unixepoch') = ?
        GROUP BY t.assigned_to ORDER BY hours DESC
      `).all(today);
    } else {
      rows = db.prepare(`
        SELECT u.full_name as name, SUM(t.time_spend) as hours
        FROM tasks t JOIN users u ON u.id = t.assigned_to
        WHERE t.time_spend > 0
          AND date(t.updated_at/1000, 'unixepoch') = ?
          AND t.team_id = ?
        GROUP BY t.assigned_to ORDER BY hours DESC
      `).all(today, s.team_id);
    }

    const total = rows.reduce(function(sum, r) { return sum + (r.hours || 0); }, 0);
    router.send(res, 200, { ok: true, data: { date: today, members: rows, total: Math.round(total * 100) / 100 } });
  });

  // ── GET /api/sprint/customers ─────────────────────────────────────────────
  router.get('/api/sprint/customers', function(req, res) {
    const s = auth.requireAuth(req, res, db);
    if (!s) return;
    const customers = db.prepare('SELECT * FROM customers WHERE active=1 ORDER BY full_name').all();
    router.send(res, 200, { ok: true, data: customers });
  });

}

module.exports = { register };
