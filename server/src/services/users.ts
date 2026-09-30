import { randomBytes, randomUUID } from 'node:crypto';
import { notFound, row, type Deps, type User } from '../http.ts';

interface UserRow {
  id: string;
  nickname: string;
  created_at: string;
}

export interface UserDto extends User {
  createdAt: string;
}

const toDto = (r: UserRow): UserDto => ({ id: r.id, nickname: r.nickname, createdAt: r.created_at });

/** 匿名（访客）注册：客户端保存返回的 token，之后所有请求带上它。 */
export function createGuest(deps: Deps, nickname: string): { user: UserDto; token: string } {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const createdAt = deps.now().toISOString();
  deps.db
    .prepare('INSERT INTO users (id, nickname, token, created_at) VALUES (?, ?, ?, ?)')
    .run(id, nickname, token, createdAt);
  return { user: { id, nickname, createdAt }, token };
}

export function userByToken(deps: Deps, token: string): User | null {
  const r = row<UserRow>(deps.db.prepare('SELECT * FROM users WHERE token = ?').get(token));
  return r ? { id: r.id, nickname: r.nickname } : null;
}

export function getUser(deps: Deps, id: string): UserDto {
  const r = row<UserRow>(deps.db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  if (!r) throw notFound('用户');
  return toDto(r);
}

export function renameUser(deps: Deps, id: string, nickname: string): UserDto {
  deps.db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, id);
  return getUser(deps, id);
}

export function userStats(deps: Deps, id: string) {
  const count = (sql: string) => row<{ n: number }>(deps.db.prepare(sql).get(id))?.n ?? 0;
  return {
    checkins: count('SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?'),
    places: count('SELECT COUNT(DISTINCT place_id) AS n FROM checkins WHERE user_id = ?'),
    songs: count('SELECT COUNT(*) AS n FROM place_songs WHERE submitted_by = ?'),
    comments: count('SELECT COUNT(*) AS n FROM comments WHERE user_id = ?'),
    likesReceived: count(
      `SELECT COUNT(*) AS n FROM votes v JOIN place_songs ps ON ps.id = v.place_song_id
       WHERE ps.submitted_by = ? AND v.value = 1 AND v.user_id != ps.submitted_by`,
    ),
  };
}
