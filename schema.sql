CREATE TABLE IF NOT EXISTS profiles (
  device_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  accuracy REAL DEFAULT 0,
  split REAL DEFAULT 0,
  updated_at TEXT
);

-- One row per finished session, used for the weekly leaderboard.
-- mode / target_size are nullable: rows logged before per-mode leaderboards
-- existed have NULL and only ever appear on the "All" board.
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  accuracy REAL DEFAULT 0,
  split REAL DEFAULT 0,
  mode TEXT,
  target_size REAL,
  created_at TEXT NOT NULL
);

-- Speeds up the "last 7 days, top score" leaderboard query.
CREATE INDEX IF NOT EXISTS idx_scores_created_at ON scores (created_at);
-- Speeds up the per-mode + standard-size leaderboard query.
CREATE INDEX IF NOT EXISTS idx_scores_mode ON scores (mode, created_at);

-- Migration for existing databases (no-op on fresh installs above):
--   ALTER TABLE scores ADD COLUMN mode TEXT;
--   ALTER TABLE scores ADD COLUMN target_size REAL;

-- Redeemed session-token nonces, so a signed token can be used to submit a
-- score exactly once (replay protection). Expired rows are purged opportunistically.
CREATE TABLE IF NOT EXISTS used_sessions (
  nonce TEXT PRIMARY KEY,
  used_at TEXT NOT NULL
);

-- Saweria donations, received via webhook and shown on the landing "supporters"
-- card. id is Saweria's transaction id (or a generated UUID) so retries dedupe.
CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  email TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_donations_created_at ON donations (created_at);
