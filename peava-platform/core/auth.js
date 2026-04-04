'use strict';

const crypto = require('crypto');
const cfg    = require('../config');

function genId()    { return crypto.randomBytes(8).toString('hex'); }
function genToken() { return crypto.randomBytes(32).toString('hex'); }

function hashPin(pin) {
  return crypto.createHash('sha256').update(pin + cfg.SALT).digest('hex');
}

function createSession(db, userId) {
  const token = genToken();
  const now   = Date.now();
  db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?,?,?,?)'
  ).run(token, userId, now + cfg.SESSION_TTL, now);
  return token;
}

function getSession(req, db) {
  const m = (req.headers.cookie || '').match(/sid=([a-f0-9]{64})/);
  if (!m) return null;
  const row = db.prepare(
    'SELECT s.token, s.user_id, s.expires_at, u.role, u.team_id, u.full_name, u.username ' +
    'FROM sessions s JOIN users u ON u.id = s.user_id ' +
    'WHERE s.token = ? AND s.expires_at > ?'
  ).get(m[1], Date.now());
  return row || null;
}

function send401(res) {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
}

function send403(res) {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Forbidden' }));
}

function requireAuth(req, res, db) {
  const s = getSession(req, db);
  if (!s) { send401(res); return null; }
  return s;
}

function requireAdmin(req, res, db) {
  const s = requireAuth(req, res, db);
  if (!s) return null;
  if (s.role !== 'admin') { send403(res); return null; }
  return s;
}

function destroySession(req, db) {
  const m = (req.headers.cookie || '').match(/sid=([a-f0-9]{64})/);
  if (m) db.prepare('DELETE FROM sessions WHERE token = ?').run(m[1]);
}

// Remove expired sessions (called at startup and periodically)
function cleanExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

module.exports = { genId, genToken, hashPin, createSession, getSession, requireAuth, requireAdmin, destroySession, cleanExpiredSessions };
