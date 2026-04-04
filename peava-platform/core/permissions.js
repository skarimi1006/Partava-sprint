'use strict';

// Returns true if the session user is allowed to perform `action` on `module`.
// Admins bypass all checks. Members are checked against team_permissions.
function can(db, session, module, action) {
  if (session.role === 'admin') return true;
  const row = db.prepare(
    'SELECT can_read, can_write, can_delete FROM team_permissions WHERE team_id = ? AND module = ?'
  ).get(session.team_id, module);
  if (!row) return false;
  return !!row['can_' + action];
}

// Like `can`, but also writes 403 to res and returns false when denied.
function enforce(db, session, module, action, res) {
  if (can(db, session, module, action)) return true;
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Forbidden' }));
  return false;
}

// Returns the list of modules a session user can read — used to build the sidebar.
function allowedModules(db, session) {
  const all = ['sprint','assets','qc','issues','deployments','delivery','knowledge','reports'];
  if (session.role === 'admin') return all;
  const rows = db.prepare(
    'SELECT module FROM team_permissions WHERE team_id = ? AND can_read = 1'
  ).all(session.team_id);
  const set = new Set(rows.map(r => r.module));
  return all.filter(m => set.has(m));
}

module.exports = { can, enforce, allowedModules };
