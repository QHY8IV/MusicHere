import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  nickname    TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS places (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  radius_m    INTEGER NOT NULL DEFAULT 150,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_places_geo ON places(lat, lng);

CREATE TABLE IF NOT EXISTS songs (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL,
  title_key   TEXT NOT NULL,
  artist_key  TEXT NOT NULL,
  url         TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (title_key, artist_key)
);

-- 一条「某地点 × 某首歌 × 某种关系」的记录。
-- kind: vibe=应景 / frequent=常听 / live=现场听到
-- source: user=用户上传 / official=官方记录
CREATE TABLE IF NOT EXISTS place_songs (
  id            TEXT PRIMARY KEY,
  place_id      TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  song_id       TEXT NOT NULL REFERENCES songs(id),
  kind          TEXT NOT NULL CHECK (kind IN ('vibe', 'frequent', 'live')),
  source        TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'official')),
  submitted_by  TEXT REFERENCES users(id),
  note          TEXT,
  event_type    TEXT CHECK (event_type IN ('concert', 'improv', 'busker', 'other')),
  performer     TEXT,
  event_title   TEXT,
  event_at      TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_place_songs_place ON place_songs(place_id);
-- 同一地点同一首歌同一种关系只保留一条；现场演出按「演出者 + 演出时间」区分不同场次。
CREATE UNIQUE INDEX IF NOT EXISTS uq_place_songs
  ON place_songs(place_id, song_id, kind, source, COALESCE(performer, ''), COALESCE(event_at, ''));

CREATE TABLE IF NOT EXISTS votes (
  user_id       TEXT NOT NULL REFERENCES users(id),
  place_song_id TEXT NOT NULL REFERENCES place_songs(id) ON DELETE CASCADE,
  value         INTEGER NOT NULL CHECK (value IN (1, -1)),
  created_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, place_song_id)
);

-- 「我也在听」：同一用户对同一条记录每天最多一次，用来累计「常听」热度。
CREATE TABLE IF NOT EXISTS listens (
  user_id       TEXT NOT NULL REFERENCES users(id),
  place_song_id TEXT NOT NULL REFERENCES place_songs(id) ON DELETE CASCADE,
  day           TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, place_song_id, day)
);

CREATE TABLE IF NOT EXISTS checkins (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  place_id    TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  distance_m  REAL NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkins_place ON checkins(place_id);
CREATE INDEX IF NOT EXISTS idx_checkins_user ON checkins(user_id, created_at);

CREATE TABLE IF NOT EXISTS comments (
  id            TEXT PRIMARY KEY,
  place_id      TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id),
  body          TEXT NOT NULL,
  mood          TEXT,
  place_song_id TEXT REFERENCES place_songs(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_place ON comments(place_id, created_at);

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id  TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);
`;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

const depth = new WeakMap<Db, number>();

/**
 * 在一个事务里执行 fn；抛错则回滚。可嵌套：内层用 SAVEPOINT，只回滚内层。
 */
export function transaction<T>(db: Db, fn: () => T): T {
  const level = depth.get(db) ?? 0;
  const name = `sp_${level}`;
  db.exec(level === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    db.exec(level === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw err;
  } finally {
    depth.set(db, level);
  }
}
