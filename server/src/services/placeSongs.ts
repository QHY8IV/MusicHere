import { randomUUID } from 'node:crypto';
import { transaction } from '../db.ts';
import { HttpError, isoDay, notFound, row, rows, type Deps } from '../http.ts';
import { songWeight, type Kind, type Source } from '../ranking.ts';

export const KINDS = ['vibe', 'frequent', 'live'] as const;
export const EVENT_TYPES = ['concert', 'improv', 'busker', 'other'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const DAY_MS = 86_400_000;
const LISTEN_WINDOW_DAYS = 30;

interface PlaceSongRow {
  id: string;
  place_id: string;
  song_id: string;
  kind: Kind;
  source: Source;
  submitted_by: string | null;
  note: string | null;
  event_type: EventType | null;
  performer: string | null;
  event_title: string | null;
  event_at: string | null;
  created_at: string;
  title: string;
  artist: string;
  url: string | null;
  submitter_nickname: string | null;
  likes: number;
  dislikes: number;
  listeners: number;
  my_vote: number | null;
  i_listened_today: number;
}

export interface PlaceSongDto {
  id: string;
  placeId: string;
  kind: Kind;
  source: Source;
  note: string | null;
  song: { id: string; title: string; artist: string; url: string | null };
  live: {
    eventType: EventType | null;
    performer: string | null;
    eventTitle: string | null;
    eventAt: string | null;
  } | null;
  submittedBy: { id: string; nickname: string } | null;
  createdAt: string;
  likes: number;
  dislikes: number;
  /** 近 30 天「我也在听」的独立人数 */
  listeners: number;
  myVote: 1 | -1 | 0;
  listenedToday: boolean;
  /** 推荐权重（仅用于展示/调试，已四舍五入） */
  weight: number;
}

function toDto(r: PlaceSongRow, now: Date): PlaceSongDto {
  const referenceAt = new Date(r.event_at ?? r.created_at);
  return {
    id: r.id,
    placeId: r.place_id,
    kind: r.kind,
    source: r.source,
    note: r.note,
    song: { id: r.song_id, title: r.title, artist: r.artist, url: r.url },
    live:
      r.kind === 'live'
        ? {
            eventType: r.event_type,
            performer: r.performer,
            eventTitle: r.event_title,
            eventAt: r.event_at,
          }
        : null,
    submittedBy: r.submitted_by
      ? { id: r.submitted_by, nickname: r.submitter_nickname ?? '匿名' }
      : null,
    createdAt: r.created_at,
    likes: r.likes,
    dislikes: r.dislikes,
    listeners: r.listeners,
    myVote: r.my_vote === 1 ? 1 : r.my_vote === -1 ? -1 : 0,
    listenedToday: r.i_listened_today > 0,
    weight:
      Math.round(
        songWeight({
          kind: r.kind,
          source: r.source,
          likes: r.likes,
          dislikes: r.dislikes,
          listeners30d: r.listeners,
          referenceAt,
          now,
        }) * 1000,
      ) / 1000,
  };
}

export interface ListOptions {
  placeId?: string;
  placeIds?: string[];
  /** 只取某一条记录 */
  id?: string;
  kind?: Kind | undefined;
  userId: string | null;
  limit?: number;
}

/** 按推荐权重降序返回记录（权重相同时新的在前）。 */
export function listPlaceSongs(deps: Deps, opts: ListOptions): PlaceSongDto[] {
  const now = deps.now();
  const ids = opts.placeIds ?? (opts.placeId ? [opts.placeId] : []);
  if (ids.length === 0 && !opts.id) return [];

  const since = isoDay(new Date(now.getTime() - LISTEN_WINDOW_DAYS * DAY_MS));
  const params: (string | number | null)[] = [since, opts.userId, opts.userId, isoDay(now)];
  let where = '1 = 1';
  if (opts.id) {
    where += ' AND ps.id = ?';
    params.push(opts.id);
  }
  if (ids.length > 0) {
    where += ` AND ps.place_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  if (opts.kind) {
    where += ' AND ps.kind = ?';
    params.push(opts.kind);
  }

  const found = rows<PlaceSongRow>(
    deps.db
      .prepare(
        `SELECT ps.*, s.title, s.artist, s.url, u.nickname AS submitter_nickname,
           (SELECT COUNT(*) FROM votes v WHERE v.place_song_id = ps.id AND v.value = 1) AS likes,
           (SELECT COUNT(*) FROM votes v WHERE v.place_song_id = ps.id AND v.value = -1) AS dislikes,
           (SELECT COUNT(DISTINCT l.user_id) FROM listens l
              WHERE l.place_song_id = ps.id AND l.day >= ?) AS listeners,
           (SELECT v.value FROM votes v WHERE v.place_song_id = ps.id AND v.user_id = ?) AS my_vote,
           (SELECT COUNT(*) FROM listens l
              WHERE l.place_song_id = ps.id AND l.user_id = ? AND l.day = ?) AS i_listened_today
         FROM place_songs ps
         JOIN songs s ON s.id = ps.song_id
         LEFT JOIN users u ON u.id = ps.submitted_by
         WHERE ${where}`,
      )
      .all(...params),
  ).map((r) => toDto(r, now));

  found.sort((a, b) => b.weight - a.weight || b.createdAt.localeCompare(a.createdAt));
  return opts.limit ? found.slice(0, opts.limit) : found;
}

export function getPlaceSong(deps: Deps, id: string, userId: string | null): PlaceSongDto {
  const found = listPlaceSongs(deps, { id, userId })[0];
  if (!found) throw notFound('歌曲记录');
  return found;
}

const normKey = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

function upsertSong(
  deps: Deps,
  title: string,
  artist: string,
  url: string | undefined,
): string {
  const titleKey = normKey(title);
  const artistKey = normKey(artist);
  const existing = row<{ id: string; url: string | null }>(
    deps.db
      .prepare('SELECT id, url FROM songs WHERE title_key = ? AND artist_key = ?')
      .get(titleKey, artistKey),
  );
  if (existing) {
    // 后来者补上了外部链接就记下来，但不覆盖已有的
    if (url && !existing.url) {
      deps.db.prepare('UPDATE songs SET url = ? WHERE id = ?').run(url, existing.id);
    }
    return existing.id;
  }
  const id = randomUUID();
  deps.db
    .prepare(
      `INSERT INTO songs (id, title, artist, title_key, artist_key, url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, title.trim(), artist.trim(), titleKey, artistKey, url ?? null, deps.now().toISOString());
  return id;
}

export interface AddPlaceSongInput {
  title: string;
  artist: string;
  url?: string | undefined;
  kind: Kind;
  note?: string | undefined;
  eventType?: EventType | undefined;
  performer?: string | undefined;
  eventTitle?: string | undefined;
  /** YYYY-MM-DD */
  eventAt?: string | undefined;
}

/**
 * 给地点添加一条歌曲记录。
 *
 * - 用户上传：同一地点同一首歌同一种关系已经存在时，不重复创建，而是把提交者记为一次点赞
 *   （「我也觉得」），并返回已有记录。
 * - 官方记录（userId 为 null）：同样去重，但不产生点赞。
 */
export function addPlaceSong(
  deps: Deps,
  userId: string | null,
  placeId: string,
  input: AddPlaceSongInput,
): { placeSong: PlaceSongDto; created: boolean } {
  if (!row(deps.db.prepare('SELECT 1 AS x FROM places WHERE id = ?').get(placeId))) {
    throw notFound('地点');
  }
  const isLive = input.kind === 'live';
  if (isLive && !input.eventType) {
    throw new HttpError(400, 'validation', '现场歌曲需要选择演出类型', {
      issues: [{ path: 'eventType', message: '必填' }],
    });
  }
  const source: Source = userId ? 'user' : 'official';

  const id = transaction(deps.db, () => {
    const songId = upsertSong(deps, input.title, input.artist, input.url);
    const performer = isLive ? (input.performer?.trim() || null) : null;
    const eventAt = isLive ? (input.eventAt ?? null) : null;

    const existing = row<{ id: string }>(
      deps.db
        .prepare(
          `SELECT id FROM place_songs
           WHERE place_id = ? AND song_id = ? AND kind = ? AND source = ?
             AND COALESCE(performer, '') = ? AND COALESCE(event_at, '') = ?`,
        )
        .get(placeId, songId, input.kind, source, performer ?? '', eventAt ?? ''),
    );

    let psId: string;
    let created: boolean;
    if (existing) {
      psId = existing.id;
      created = false;
    } else {
      psId = randomUUID();
      created = true;
      deps.db
        .prepare(
          `INSERT INTO place_songs
             (id, place_id, song_id, kind, source, submitted_by, note,
              event_type, performer, event_title, event_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          psId,
          placeId,
          songId,
          input.kind,
          source,
          userId,
          input.note?.trim() || null,
          isLive ? input.eventType! : null,
          performer,
          isLive ? (input.eventTitle?.trim() || null) : null,
          eventAt,
          deps.now().toISOString(),
        );
    }

    if (userId) {
      // 提交者本人自动点赞；「常听」同时记一次今天在听
      castVote(deps, userId, psId, 1);
      if (input.kind === 'frequent') recordListen(deps, userId, psId);
    }
    return { psId, created };
  });

  return { placeSong: getPlaceSong(deps, id.psId, userId), created: id.created };
}

function castVote(deps: Deps, userId: string, placeSongId: string, value: 1 | -1) {
  deps.db
    .prepare(
      `INSERT INTO votes (user_id, place_song_id, value, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, place_song_id) DO UPDATE SET value = excluded.value`,
    )
    .run(userId, placeSongId, value, deps.now().toISOString());
}

function recordListen(deps: Deps, userId: string, placeSongId: string) {
  const now = deps.now();
  deps.db
    .prepare(
      `INSERT OR IGNORE INTO listens (user_id, place_song_id, day, created_at) VALUES (?, ?, ?, ?)`,
    )
    .run(userId, placeSongId, isoDay(now), now.toISOString());
}

function assertExists(deps: Deps, placeSongId: string) {
  if (!row(deps.db.prepare('SELECT 1 AS x FROM place_songs WHERE id = ?').get(placeSongId))) {
    throw notFound('歌曲记录');
  }
}

/** value: 1 点赞 / -1 点踩 / 0 取消。返回最新状态。 */
export function setVote(
  deps: Deps,
  userId: string,
  placeSongId: string,
  value: 1 | -1 | 0,
): PlaceSongDto {
  assertExists(deps, placeSongId);
  if (value === 0) {
    deps.db
      .prepare('DELETE FROM votes WHERE user_id = ? AND place_song_id = ?')
      .run(userId, placeSongId);
  } else {
    castVote(deps, userId, placeSongId, value);
  }
  return getPlaceSong(deps, placeSongId, userId);
}

/** 「我也在这听这首歌」。同一天重复调用是幂等的。 */
export function addListen(deps: Deps, userId: string, placeSongId: string): PlaceSongDto {
  assertExists(deps, placeSongId);
  recordListen(deps, userId, placeSongId);
  return getPlaceSong(deps, placeSongId, userId);
}

/** 只有提交者本人可以删除自己上传的记录。官方记录不可通过此接口删除。 */
export function deletePlaceSong(deps: Deps, userId: string, placeSongId: string) {
  const r = row<{ submitted_by: string | null }>(
    deps.db.prepare('SELECT submitted_by FROM place_songs WHERE id = ?').get(placeSongId),
  );
  if (!r) throw notFound('歌曲记录');
  if (r.submitted_by !== userId) throw new HttpError(403, 'forbidden', '只能删除自己上传的记录');
  deps.db.prepare('DELETE FROM place_songs WHERE id = ?').run(placeSongId);
}

export function mySongs(
  deps: Deps,
  userId: string,
  limit: number,
): (PlaceSongDto & { placeName: string })[] {
  const ids = rows<{ id: string; place_name: string; created_at: string }>(
    deps.db
      .prepare(
        `SELECT ps.id, p.name AS place_name, ps.created_at FROM place_songs ps
         JOIN places p ON p.id = ps.place_id
         WHERE ps.submitted_by = ? ORDER BY ps.created_at DESC LIMIT ?`,
      )
      .all(userId, limit),
  );
  return ids.map((r) => ({ ...getPlaceSong(deps, r.id, userId), placeName: r.place_name }));
}
