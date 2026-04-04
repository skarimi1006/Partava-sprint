'use strict';

const { genId } = require('./auth');

// ---------------------------------------------------------------------------
// Internal notification storage
// ---------------------------------------------------------------------------
function create(db, { userId, teamId, module, type, title, body, recordId }) {
  db.prepare(
    'INSERT INTO notifications (id,user_id,team_id,module,type,title,body,record_id,read,created_at) VALUES (?,?,?,?,?,?,?,?,0,?)'
  ).run(genId(), userId || null, teamId || null, module, type, title, body, recordId || null, Date.now());
}

function getForUser(db, userId) {
  return db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? OR team_id IN (SELECT team_id FROM users WHERE id = ?) ORDER BY created_at DESC LIMIT 50'
  ).all(userId, userId);
}

function getUnreadCount(db, userId) {
  return db.prepare(
    'SELECT COUNT(*) as c FROM notifications WHERE (user_id = ? OR team_id IN (SELECT team_id FROM users WHERE id = ?)) AND read = 0'
  ).get(userId, userId).c;
}

function markRead(db, notifId, userId) {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND (user_id = ? OR user_id IS NULL)').run(notifId, userId);
}

// ---------------------------------------------------------------------------
// Dispatcher — routes to internal + optional SMS/email
// SMS and email are wired up when provider details are confirmed.
// ---------------------------------------------------------------------------
async function notify(db, opts) {
  create(db, opts);
  // TODO: SMS  → POST to config.SMS.url when provider is set
  // TODO: Email → nodemailer using config.SMTP when configured
}

module.exports = { notify, create, getForUser, getUnreadCount, markRead };
