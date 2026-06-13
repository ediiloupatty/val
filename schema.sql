CREATE TABLE IF NOT EXISTS profiles (
  device_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  accuracy REAL DEFAULT 0,
  split REAL DEFAULT 0,
  updated_at TEXT
);

-- One row per finished session, used for the weekly leaderboard.
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  accuracy REAL DEFAULT 0,
  split REAL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Speeds up the "last 7 days, top score" leaderboard query.
CREATE INDEX IF NOT EXISTS idx_scores_created_at ON scores (created_at);

-- Redeemed session-token nonces, so a signed token can be used to submit a
-- score exactly once (replay protection). Expired rows are purged opportunistically.
CREATE TABLE IF NOT EXISTS used_sessions (
  nonce TEXT PRIMARY KEY,
  used_at TEXT NOT NULL
);
