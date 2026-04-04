'use strict';

const { genId } = require('./auth');

// Append-only audit log writer. No delete API is exposed.
function log(db, userId, action, module, recordId, detail, ip) {
  db.prepare(
    'INSERT INTO audit_log (id,user_id,action,module,record_id,detail,ip,created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(
    genId(),
    userId,
    action,
    module,
    recordId || null,
    detail ? JSON.stringify(detail) : null,
    ip     || null,
    Date.now()
  );
}

module.exports = { log };
