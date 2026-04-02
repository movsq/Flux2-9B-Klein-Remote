import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.DB_PATH || './data/comfylink.db';

// Ensure the directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// ── Pragmas ───────────────────────────────────────────────────────────────────
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub  TEXT    UNIQUE NOT NULL,
    email       TEXT    NOT NULL,
    name        TEXT    NOT NULL DEFAULT '',
    picture     TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'active', 'suspended')),
    is_admin    INTEGER NOT NULL DEFAULT 0
                        CHECK (is_admin IN (0, 1)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invite_codes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT    UNIQUE NOT NULL,
    type            TEXT    NOT NULL DEFAULT 'registration'
                            CHECK (type IN ('registration', 'job_access')),
    created_by      INTEGER NOT NULL REFERENCES users(id),
    uses_remaining  INTEGER,
    expires_at      INTEGER,
    created_at      INTEGER NOT NULL
  );
`);

// ── Prepared statements ───────────────────────────────────────────────────────

// Users
const stmtFindByGoogleSub = db.prepare(
  'SELECT * FROM users WHERE google_sub = ?',
);

const stmtCreateUser = db.prepare(`
  INSERT INTO users (google_sub, email, name, picture, status, is_admin, created_at, updated_at)
  VALUES (@google_sub, @email, @name, @picture, @status, @is_admin, @created_at, @updated_at)
`);

const stmtGetUserById = db.prepare('SELECT * FROM users WHERE id = ?');

const stmtUpdateUserStatus = db.prepare(
  'UPDATE users SET status = @status, updated_at = @updated_at WHERE id = @id',
);

const stmtSetAdmin = db.prepare(
  'UPDATE users SET is_admin = @is_admin, updated_at = @updated_at WHERE id = @id',
);

const stmtFindByEmail = db.prepare('SELECT * FROM users WHERE email = ?');

// Invite codes
const stmtCreateCode = db.prepare(`
  INSERT INTO invite_codes (code, type, created_by, uses_remaining, expires_at, created_at)
  VALUES (@code, @type, @created_by, @uses_remaining, @expires_at, @created_at)
`);

const stmtFindCode = db.prepare('SELECT * FROM invite_codes WHERE code = ?');

const stmtDecrementCodeUses = db.prepare(
  'UPDATE invite_codes SET uses_remaining = uses_remaining - 1 WHERE id = ?',
);

const stmtGetCodesByCreator = db.prepare(
  'SELECT * FROM invite_codes WHERE created_by = ? ORDER BY created_at DESC',
);

const stmtDeleteCode = db.prepare(
  'DELETE FROM invite_codes WHERE id = ? AND created_by = ?',
);

// ── Public API ────────────────────────────────────────────────────────────────

export function findUserByGoogleSub(googleSub) {
  return stmtFindByGoogleSub.get(googleSub) ?? null;
}

export function findUserByEmail(email) {
  return stmtFindByEmail.get(email) ?? null;
}

export function getUserById(id) {
  return stmtGetUserById.get(id) ?? null;
}

export function createUser({ googleSub, email, name, picture, status = 'pending', isAdmin = false }) {
  const now = Date.now();
  const result = stmtCreateUser.run({
    google_sub: googleSub,
    email,
    name,
    picture,
    status,
    is_admin: isAdmin ? 1 : 0,
    created_at: now,
    updated_at: now,
  });
  return stmtGetUserById.get(result.lastInsertRowid);
}

export function updateUserStatus(id, status) {
  return stmtUpdateUserStatus.run({ id, status, updated_at: Date.now() });
}

export function setUserAdmin(id, isAdmin) {
  return stmtSetAdmin.run({ id, is_admin: isAdmin ? 1 : 0, updated_at: Date.now() });
}

// Invite codes

export function createInviteCode({ code, type = 'registration', createdBy, usesRemaining = null, expiresAt = null }) {
  return stmtCreateCode.run({
    code,
    type,
    created_by: createdBy,
    uses_remaining: usesRemaining,
    expires_at: expiresAt,
    created_at: Date.now(),
  });
}

export function findInviteCode(code) {
  return stmtFindCode.get(code) ?? null;
}

export function decrementCodeUses(id) {
  return stmtDecrementCodeUses.run(id);
}

export function getCodesByCreator(userId) {
  return stmtGetCodesByCreator.all(userId);
}

export function deleteInviteCode(id, createdBy) {
  return stmtDeleteCode.run(id, createdBy);
}

/**
 * Validate an invite code: exists, not expired, has remaining uses, correct type.
 * Returns the code row if valid, null otherwise.
 */
export function validateInviteCode(code, type = 'registration') {
  const row = findInviteCode(code);
  if (!row) return null;
  if (row.type !== type) return null;
  if (row.expires_at !== null && Date.now() > row.expires_at) return null;
  if (row.uses_remaining !== null && row.uses_remaining <= 0) return null;
  return row;
}

export default db;
