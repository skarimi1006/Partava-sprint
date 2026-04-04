'use strict';

const http   = require('http');
const path   = require('path');
const fs     = require('fs');
const config = require('./config');

// ---------------------------------------------------------------------------
// Core subsystems
// ---------------------------------------------------------------------------
const { db }          = require('./core/db');
const router          = require('./core/router');
const auth            = require('./core/auth');
const audit           = require('./core/audit');
const perms           = require('./core/permissions');
const notif           = require('./core/notifications');
const { toShamsi }    = require('./core/shamsi');

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------
require('./modules/sprint').register(router, db);

const PUB_DIR = path.join(__dirname, 'public');
const MOD_DIR = path.join(__dirname, 'modules');

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------
const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.css':   'text/css',
  '.js':    'application/javascript',
  '.json':  'application/json',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.ico':   'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.ttf':   'font/ttf',
};

function serveFile(res, fp) {
  if (!fs.existsSync(fp)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext  = path.extname(fp);
  const mime = MIME[ext] || 'text/plain';
  res.writeHead(200, { 'Content-Type': mime });
  res.end(fs.readFileSync(fp));
}

function serveStatic(req, res) {
  const p = new URL(req.url, 'http://localhost').pathname;
  if (p === '/' || p === '/index.html') return serveFile(res, path.join(PUB_DIR, 'index.html'));
  if (p === '/app' || p === '/app.html')  return serveFile(res, path.join(PUB_DIR, 'app.html'));
  // Serve module panel.html / panel.js from the modules/ directory
  if (p.startsWith('/modules/')) return serveFile(res, path.join(MOD_DIR, p.slice('/modules/'.length)));
  return serveFile(res, path.join(PUB_DIR, p.slice(1)));
}

// ---------------------------------------------------------------------------
// Shared API routes
// ---------------------------------------------------------------------------

// POST /api/auth/login
router.post('/api/auth/login', (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) return router.send(res, 400, { ok: false, error: 'Missing credentials' });
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(
    String(username).toLowerCase().trim()
  );
  if (!user || user.pin_hash !== auth.hashPin(String(pin))) {
    return router.send(res, 401, { ok: false, error: 'Invalid username or PIN' });
  }
  const token = auth.createSession(db, user.id);
  audit.log(db, user.id, 'login', 'auth', null, null, null);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': `sid=${token}; HttpOnly; Path=/; Max-Age=${config.SESSION_TTL / 1000}`
  });
  res.end(JSON.stringify({ ok: true, data: { role: user.role, redirect: '/app' } }));
});

// POST /api/auth/logout
router.post('/api/auth/logout', (req, res) => {
  const s = auth.getSession(req, db);
  if (s) {
    audit.log(db, s.user_id, 'logout', 'auth', null, null, null);
    auth.destroySession(req, db);
  }
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0'
  });
  res.end(JSON.stringify({ ok: true }));
});

// POST /api/auth/change-pin
router.post('/api/auth/change-pin', (req, res) => {
  const s = auth.requireAuth(req, res, db);
  if (!s) return;
  const { oldPin, newPin } = req.body;
  if (!oldPin || !newPin || String(newPin).length < 4)
    return router.send(res, 400, { ok: false, error: 'Invalid PIN' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (user.pin_hash !== auth.hashPin(String(oldPin)))
    return router.send(res, 401, { ok: false, error: 'Incorrect current PIN' });
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(auth.hashPin(String(newPin)), s.user_id);
  audit.log(db, s.user_id, 'update', 'auth', s.user_id, { action: 'change-pin' }, null);
  router.send(res, 200, { ok: true });
});

// GET /api/me
router.get('/api/me', (req, res) => {
  const s = auth.requireAuth(req, res, db);
  if (!s) return;
  const user = db.prepare('SELECT id,username,full_name,role,team_id,job_title FROM users WHERE id = ?').get(s.user_id);
  const modules = perms.allowedModules(db, s);
  router.send(res, 200, { ok: true, data: { ...user, modules } });
});

// GET /api/teams
router.get('/api/teams', (req, res) => {
  const s = auth.requireAuth(req, res, db);
  if (!s) return;
  const teams = db.prepare('SELECT * FROM teams ORDER BY name').all();
  router.send(res, 200, { ok: true, data: teams });
});

// POST /api/teams  (admin)
router.post('/api/teams', (req, res) => {
  const s = auth.requireAdmin(req, res, db);
  if (!s) return;
  const { name, color } = req.body;
  if (!name) return router.send(res, 400, { ok: false, error: 'Name required' });
  const id = auth.genId();
  const now = Date.now();
  db.prepare('INSERT INTO teams (id,name,color,created_at) VALUES (?,?,?,?)').run(
    id, String(name).trim(), color || '#00928A', now
  );
  audit.log(db, s.user_id, 'create', 'teams', id, { name }, null);
  router.send(res, 200, { ok: true, data: { id } });
});

// PUT /api/teams/:id  (admin)
router.put('/api/teams/:id', (req, res, params) => {
  const s = auth.requireAdmin(req, res, db);
  if (!s) return;
  const { name, color } = req.body;
  db.prepare('UPDATE teams SET name = COALESCE(?,name), color = COALESCE(?,color) WHERE id = ?').run(
    name || null, color || null, params.id
  );
  audit.log(db, s.user_id, 'update', 'teams', params.id, { name, color }, null);
  router.send(res, 200, { ok: true });
});

// DELETE /api/teams/:id  (admin)
router.del('/api/teams/:id', (req, res, params) => {
  const s = auth.requireAdmin(req, res, db);
  if (!s) return;
  db.prepare('DELETE FROM teams WHERE id = ?').run(params.id);
  audit.log(db, s.user_id, 'delete', 'teams', params.id, null, null);
  router.send(res, 200, { ok: true });
});

// GET /api/users
router.get('/api/users', (req, res) => {
  const s = auth.requireAuth(req, res, db);
  if (!s) return;
  const users = s.role === 'admin'
    ? db.prepare('SELECT id,username,full_name,role,team_id,job_title,active FROM users ORDER BY full_name').all()
    : db.prepare('SELECT id,username,full_name,role,team_id,job_title,active FROM users WHERE team_id = ? ORDER BY full_name').all(s.team_id);
  router.send(res, 200, { ok: true, data: users });
});

// POST /api/users  (admin)
router.post('/api/users', (req, res) => {
  const s = auth.requireAdmin(req, res, db);
  if (!s) return;
  const { username, pin, full_name, role, team_id, job_title } = req.body;
  if (!username || !pin || !full_name || !role || !team_id)
    return router.send(res, 400, { ok: false, error: 'Missing required fields' });
  const id = auth.genId();
  db.prepare('INSERT INTO users (id,username,pin_hash,full_name,role,team_id,job_title,active,created_at) VALUES (?,?,?,?,?,?,?,1,?)').run(
    id, String(username).toLowerCase().trim(), auth.hashPin(String(pin)),
    full_name, role, team_id, job_title || null, Date.now()
  );
  audit.log(db, s.user_id, 'create', 'users', id, { username, role }, null);
  router.send(res, 200, { ok: true, data: { id } });
});

// PUT /api/users/:id  (admin)
router.put('/api/users/:id', (req, res, params) => {
  const s = auth.requireAdmin(req, res, db);
  if (!s) return;
  const { full_name, role, team_id, job_title, active, pin } = req.body;
  if (pin) {
    db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(auth.hashPin(String(pin)), params.id);
  }
  db.prepare(
    'UPDATE users SET full_name=COALESCE(?,full_name), role=COALESCE(?,role), team_id=COALESCE(?,team_id), job_title=COALESCE(?,job_title), active=COALESCE(?,active) WHERE id=?'
  ).run(full_name||null, role||null, team_id||null, job_title||null, active !== undefined ? active : null, params.id);
  audit.log(db, s.user_id, 'update', 'users', params.id, { full_name, role }, null);
  router.send(res, 200, { ok: true });
});

// DELETE /api/users/:id  (admin)
router.del('/api/users/:id', (req, res, params) => {
  const s = auth.requireAdmin(req, res, db);
  if (!s) return;
  if (params.id === s.user_id) return router.send(res, 400, { ok: false, error: 'Cannot delete yourself' });
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(params.id);
  audit.log(db, s.user_id, 'delete', 'users', params.id, null, null);
  router.send(res, 200, { ok: true });
});

// GET /api/notifications
router.get('/api/notifications', (req, res) => {
  const s = auth.requireAuth(req, res, db);
  if (!s) return;
  const items = notif.getForUser(db, s.user_id);
  router.send(res, 200, { ok: true, data: items });
});

// GET /api/notifications/unread
router.get('/api/notifications/unread', (req, res) => {
  const s = auth.requireAuth(req, res, db);
  if (!s) return;
  router.send(res, 200, { ok: true, data: { count: notif.getUnreadCount(db, s.user_id) } });
});

// POST /api/notifications/:id/read
router.post('/api/notifications/:id/read', (req, res, params) => {
  const s = auth.requireAuth(req, res, db);
  if (!s) return;
  notif.markRead(db, params.id, s.user_id);
  router.send(res, 200, { ok: true });
});

// GET /api/audit-log  (admin)
router.get('/api/audit-log', (req, res) => {
  const s = auth.requireAdmin(req, res, db);
  if (!s) return;
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const rows = db.prepare(
    'SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as c FROM audit_log').get().c;
  router.send(res, 200, { ok: true, data: { rows, total, page, limit } });
});

// GET /api/permissions  (admin — manage team module access)
router.get('/api/permissions', (req, res) => {
  const s = auth.requireAdmin(req, res, db);
  if (!s) return;
  const rows = db.prepare('SELECT * FROM team_permissions ORDER BY team_id, module').all();
  router.send(res, 200, { ok: true, data: rows });
});

// PUT /api/permissions/:id  (admin)
router.put('/api/permissions/:id', (req, res, params) => {
  const s = auth.requireAdmin(req, res, db);
  if (!s) return;
  const { can_read, can_write, can_delete } = req.body;
  db.prepare('UPDATE team_permissions SET can_read=?,can_write=?,can_delete=?,updated_at=? WHERE id=?').run(
    can_read ? 1 : 0, can_write ? 1 : 0, can_delete ? 1 : 0, Date.now(), params.id
  );
  router.send(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// Auto-archive cron — mark Done tasks older than 7 days as archived
// ---------------------------------------------------------------------------
function runAutoArchive() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const result = db.prepare(
    "UPDATE tasks SET archived=1, archived_at=? WHERE status='Done' AND updated_at <= ? AND archived=0"
  ).run(Date.now(), cutoff);
  if (result.changes > 0) console.log(`[auto-archive] Archived ${result.changes} completed tasks`);
}

// Weekly sprint reset — every Saturday (day 6)
function checkWeeklyReset() {
  const now      = new Date();
  const day      = now.getDay();
  if (day !== 6) return;
  const todayStr = now.toISOString().split('T')[0];
  const meta     = db.prepare("SELECT id FROM audit_log WHERE action='sprint_reset' AND detail LIKE ? ORDER BY created_at DESC LIMIT 1").get('%' + todayStr + '%');
  if (meta) return;  // already reset today
  // Only archive Done tasks — To Do and In Progress carry forward to next sprint
  db.prepare("UPDATE tasks SET archived=1, archived_at=? WHERE status='Done' AND archived=0").run(Date.now());
  // Write a sentinel audit entry so we don't reset again today
  db.prepare("INSERT INTO audit_log (id,user_id,action,module,record_id,detail,ip,created_at) VALUES (?,?,?,?,?,?,?,?)").run(
    auth.genId(), null, 'sprint_reset', 'sprint', null, JSON.stringify({ date: todayStr }), null, Date.now()
  );
  console.log('[weekly-reset] Sprint reset completed:', todayStr);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
auth.cleanExpiredSessions(db);
runAutoArchive();
checkWeeklyReset();
setInterval(runAutoArchive,    60 * 60 * 1000);   // hourly
setInterval(checkWeeklyReset,  60 * 60 * 1000);   // hourly check

http.createServer(async (req, res) => {
  const method = req.method.toUpperCase();
  const p      = new URL(req.url, 'http://localhost').pathname;

  // Serve static files for non-API routes
  if (!p.startsWith('/api')) {
    return serveStatic(req, res);
  }

  try {
    await router.dispatch(req, res, db);
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Internal server error' }));
    }
  }
}).listen(config.PORT, () => {
  console.log(`Peava Platform v1.0 → http://localhost:${config.PORT}`);
});
