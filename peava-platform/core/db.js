'use strict';

const path   = require('path');
const fs     = require('fs');
const cfg    = require('../config');

// Ensure data directory exists before opening DB
const dbDir = path.dirname(path.resolve(cfg.DB_PATH));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const Database = require('better-sqlite3');
const db = new Database(cfg.DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema — all tables created in dependency order
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#00928A',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT UNIQUE NOT NULL,
    pin_hash   TEXT NOT NULL,
    full_name  TEXT NOT NULL,
    role       TEXT NOT NULL CHECK(role IN ('admin','member')),
    team_id    TEXT NOT NULL REFERENCES teams(id),
    job_title  TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team_permissions (
    id         TEXT PRIMARY KEY,
    team_id    TEXT NOT NULL REFERENCES teams(id),
    module     TEXT NOT NULL,
    can_read   INTEGER NOT NULL DEFAULT 1,
    can_write  INTEGER NOT NULL DEFAULT 0,
    can_delete INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         TEXT PRIMARY KEY,
    user_id    TEXT REFERENCES users(id),
    action     TEXT NOT NULL,
    module     TEXT NOT NULL,
    record_id  TEXT,
    detail     TEXT,
    ip         TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT REFERENCES users(id),
    team_id    TEXT REFERENCES teams(id),
    module     TEXT NOT NULL,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    record_id  TEXT,
    read       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id            TEXT PRIMARY KEY,
    code          TEXT UNIQUE NOT NULL,
    full_name     TEXT NOT NULL,
    type          TEXT NOT NULL CHECK(type IN ('bank','psp','internal','other')),
    contact_name  TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id               TEXT PRIMARY KEY,
    serial_number    TEXT UNIQUE NOT NULL,
    model            TEXT NOT NULL,
    manufacturer     TEXT NOT NULL,
    asset_type       TEXT NOT NULL CHECK(asset_type IN ('terminal','printer','pinpad','other')),
    os_type          TEXT,
    firmware_version TEXT,
    status           TEXT NOT NULL CHECK(status IN ('in_stock','deployed','in_qc','faulty','retired')),
    customer_id      TEXT REFERENCES customers(id),
    location         TEXT,
    purchase_date    INTEGER,
    warranty_until   INTEGER,
    notes            TEXT,
    created_by       TEXT NOT NULL REFERENCES users(id),
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    category      TEXT NOT NULL CHECK(category IN ('QC Test','R&D','Development','Bug Fix','Follow Up')),
    priority      TEXT NOT NULL CHECK(priority IN ('Low','Medium','High','Critical')),
    status        TEXT NOT NULL CHECK(status IN ('To Do','In Progress','Done')),
    assigned_to   TEXT REFERENCES users(id),
    team_id       TEXT NOT NULL REFERENCES teams(id),
    customer_id   TEXT REFERENCES customers(id),
    source_module TEXT,
    source_id     TEXT,
    version       TEXT,
    notes         TEXT,
    time_spend    REAL NOT NULL DEFAULT 0,
    due_date      INTEGER,
    done_date     INTEGER,
    done_date_shamsi TEXT,
    archived      INTEGER NOT NULL DEFAULT 0,
    archived_at   INTEGER,
    created_by    TEXT NOT NULL REFERENCES users(id),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_comments (
    id         TEXT PRIMARY KEY,
    task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id),
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS qc_tests (
    id               TEXT PRIMARY KEY,
    asset_id         TEXT REFERENCES assets(id),
    batch_id         TEXT,
    tester_id        TEXT NOT NULL REFERENCES users(id),
    firmware_version TEXT,
    test_date        INTEGER NOT NULL,
    test_date_shamsi TEXT NOT NULL,
    overall_result   TEXT NOT NULL CHECK(overall_result IN ('pass','fail','partial')),
    notes            TEXT,
    created_at       INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS qc_test_cases (
    id         TEXT PRIMARY KEY,
    qc_test_id TEXT NOT NULL REFERENCES qc_tests(id) ON DELETE CASCADE,
    test_name  TEXT NOT NULL,
    result     TEXT NOT NULL CHECK(result IN ('pass','fail','skip')),
    detail     TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS qc_task_links (
    qc_test_id TEXT NOT NULL REFERENCES qc_tests(id),
    task_id    TEXT NOT NULL REFERENCES tasks(id),
    PRIMARY KEY (qc_test_id, task_id)
  );

  CREATE TABLE IF NOT EXISTS issues (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT,
    type        TEXT NOT NULL CHECK(type IN ('bug','feature_request','complaint','inquiry','other')),
    priority    TEXT NOT NULL CHECK(priority IN ('Low','Medium','High','Critical')),
    status      TEXT NOT NULL CHECK(status IN ('Open','In Progress','Resolved','Closed','Rejected')),
    customer_id TEXT REFERENCES customers(id),
    asset_id    TEXT REFERENCES assets(id),
    assigned_to TEXT REFERENCES users(id),
    team_id     TEXT NOT NULL REFERENCES teams(id),
    version     TEXT,
    resolution  TEXT,
    resolved_at INTEGER,
    created_by  TEXT NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS issue_comments (
    id         TEXT PRIMARY KEY,
    issue_id   TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id),
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS issue_attachments (
    id          TEXT PRIMARY KEY,
    issue_id    TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    path        TEXT NOT NULL,
    size        INTEGER,
    uploaded_by TEXT NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS issue_task_links (
    issue_id TEXT NOT NULL REFERENCES issues(id),
    task_id  TEXT NOT NULL REFERENCES tasks(id),
    PRIMARY KEY (issue_id, task_id)
  );

  CREATE TABLE IF NOT EXISTS releases (
    id               TEXT PRIMARY KEY,
    version          TEXT NOT NULL,
    product          TEXT NOT NULL,
    release_type     TEXT NOT NULL CHECK(release_type IN ('major','minor','patch','hotfix')),
    status           TEXT NOT NULL CHECK(status IN ('planned','in_qc','approved','released','recalled')),
    release_notes    TEXT,
    release_date     INTEGER,
    release_date_shamsi TEXT,
    created_by       TEXT NOT NULL REFERENCES users(id),
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deployments (
    id                  TEXT PRIMARY KEY,
    release_id          TEXT NOT NULL REFERENCES releases(id),
    customer_id         TEXT NOT NULL REFERENCES customers(id),
    status              TEXT NOT NULL CHECK(status IN ('scheduled','sent','installed','failed','rolled_back')),
    deployed_by         TEXT REFERENCES users(id),
    deploy_date         INTEGER,
    deploy_date_shamsi  TEXT,
    notes               TEXT,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS release_qc_links (
    release_id TEXT NOT NULL REFERENCES releases(id),
    qc_test_id TEXT NOT NULL REFERENCES qc_tests(id),
    PRIMARY KEY (release_id, qc_test_id)
  );

  CREATE TABLE IF NOT EXISTS release_task_links (
    release_id TEXT NOT NULL REFERENCES releases(id),
    task_id    TEXT NOT NULL REFERENCES tasks(id),
    PRIMARY KEY (release_id, task_id)
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id                TEXT PRIMARY KEY,
    deployment_id     TEXT REFERENCES deployments(id),
    customer_id       TEXT NOT NULL REFERENCES customers(id),
    release_id        TEXT NOT NULL REFERENCES releases(id),
    letter_text       TEXT NOT NULL,
    letter_image_path TEXT,
    letter_pdf_path   TEXT,
    signed_by         TEXT REFERENCES users(id),
    signature_path    TEXT,
    sent_email        INTEGER NOT NULL DEFAULT 0,
    email_sent_at     INTEGER,
    email_recipient   TEXT,
    status            TEXT NOT NULL CHECK(status IN ('draft','generated','sent')),
    created_by        TEXT NOT NULL REFERENCES users(id),
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kb_articles (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    category   TEXT NOT NULL,
    tags       TEXT,
    author_id  TEXT NOT NULL REFERENCES users(id),
    visibility TEXT NOT NULL CHECK(visibility IN ('all','team')) DEFAULT 'all',
    team_id    TEXT REFERENCES teams(id),
    views      INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// ---------------------------------------------------------------------------
// Seed — insert defaults only if tables are empty
// ---------------------------------------------------------------------------
function seed() {
  const crypto = require('crypto');
  const cfg    = require('../config');

  function genId() { return crypto.randomBytes(8).toString('hex'); }
  function hashPin(pin) {
    return crypto.createHash('sha256').update(pin + cfg.SALT).digest('hex');
  }

  const now = Date.now();

  // Teams
  if (db.prepare('SELECT COUNT(*) as c FROM teams').get().c === 0) {
    const t1 = genId(), t2 = genId();
    db.prepare('INSERT INTO teams VALUES (?,?,?,?)').run(t1, 'QC & Customer Support', '#00928A', now);
    db.prepare('INSERT INTO teams VALUES (?,?,?,?)').run(t2, 'Development', '#4A90D9', now);

    // Admin user (saeed / 1234)
    const adminId = genId();
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run(
      adminId, 'saeed', hashPin('1234'), 'Saeed', 'admin', t1, 'Admin', 1, now
    );

    // Grant all permissions for both teams on all modules
    const modules = ['sprint','assets','qc','issues','deployments','delivery','knowledge','reports'];
    for (const teamId of [t1, t2]) {
      for (const mod of modules) {
        db.prepare('INSERT INTO team_permissions VALUES (?,?,?,?,?,?,?)').run(
          genId(), teamId, mod, 1, 1, 0, now
        );
      }
    }

    console.log('Database seeded — default admin: saeed / 1234');
  }
}

seed();

module.exports = { db };
