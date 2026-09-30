import { randomUUID } from 'node:crypto';
import { HttpError, notFound, row, rows, type Deps } from '../http.ts';

interface CommentRow {
  id: string;
  place_id: string;
  user_id: string;
  body: string;
  mood: string | null;
  place_song_id: string | null;
  created_at: string;
  nickname: string;
  likes: number;
  liked_by_me: number;
  song_title: string | null;
  song_artist: string | null;
}

export interface CommentDto {
  id: string;
  placeId: string;
  body: string;
  mood: string | null;
  author: { id: string; nickname: string };
  song: { placeSongId: string; title: string; artist: string } | null;
  likes: number;
  likedByMe: boolean;
  createdAt: string;
}

const toDto = (r: CommentRow): CommentDto => ({
  id: r.id,
  placeId: r.place_id,
  body: r.body,
  mood: r.mood,
  author: { id: r.user_id, nickname: r.nickname },
  song:
    r.place_song_id && r.song_title
      ? { placeSongId: r.place_song_id, title: r.song_title, artist: r.song_artist ?? '' }
      : null,
  likes: r.likes,
  likedByMe: r.liked_by_me > 0,
  createdAt: r.created_at,
});

const SELECT = `
  SELECT c.*, u.nickname,
    (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS likes,
    (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) AS liked_by_me,
    s.title AS song_title, s.artist AS song_artist
  FROM comments c
  JOIN users u ON u.id = c.user_id
  LEFT JOIN place_songs ps ON ps.id = c.place_song_id
  LEFT JOIN songs s ON s.id = ps.song_id`;

/** 新评论在前；before 为上一页最后一条的 createdAt，用于翻页。 */
export function listComments(
  deps: Deps,
  placeId: string,
  viewerId: string | null,
  opts: { limit: number; before?: string | undefined },
): CommentDto[] {
  const params: (string | number | null)[] = [viewerId, placeId];
  let where = 'c.place_id = ?';
  if (opts.before) {
    where += ' AND c.created_at < ?';
    params.push(opts.before);
  }
  params.push(opts.limit);
  return rows<CommentRow>(
    deps.db
      .prepare(`${SELECT} WHERE ${where} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`)
      .all(...params),
  ).map(toDto);
}

export function getComment(deps: Deps, id: string, viewerId: string | null): CommentDto {
  const r = row<CommentRow>(deps.db.prepare(`${SELECT} WHERE c.id = ?`).get(viewerId, id));
  if (!r) throw notFound('评论');
  return toDto(r);
}

export function addComment(
  deps: Deps,
  userId: string,
  placeId: string,
  input: { body: string; mood?: string | undefined; placeSongId?: string | undefined },
): CommentDto {
  if (!row(deps.db.prepare('SELECT 1 AS x FROM places WHERE id = ?').get(placeId))) {
    throw notFound('地点');
  }
  if (input.placeSongId) {
    const ps = row<{ place_id: string }>(
      deps.db.prepare('SELECT place_id FROM place_songs WHERE id = ?').get(input.placeSongId),
    );
    if (!ps || ps.place_id !== placeId) {
      throw new HttpError(400, 'validation', '关联的歌曲不属于该地点', {
        issues: [{ path: 'placeSongId', message: '无效' }],
      });
    }
  }
  const id = randomUUID();
  deps.db
    .prepare(
      `INSERT INTO comments (id, place_id, user_id, body, mood, place_song_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      placeId,
      userId,
      input.body,
      input.mood ?? null,
      input.placeSongId ?? null,
      deps.now().toISOString(),
    );
  return getComment(deps, id, userId);
}

export function setCommentLike(
  deps: Deps,
  userId: string,
  commentId: string,
  liked: boolean,
): CommentDto {
  if (!row(deps.db.prepare('SELECT 1 AS x FROM comments WHERE id = ?').get(commentId))) {
    throw notFound('评论');
  }
  if (liked) {
    deps.db
      .prepare(
        'INSERT OR IGNORE INTO comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?)',
      )
      .run(commentId, userId, deps.now().toISOString());
  } else {
    deps.db
      .prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?')
      .run(commentId, userId);
  }
  return getComment(deps, commentId, userId);
}

export function deleteComment(deps: Deps, userId: string, commentId: string) {
  const r = row<{ user_id: string }>(
    deps.db.prepare('SELECT user_id FROM comments WHERE id = ?').get(commentId),
  );
  if (!r) throw notFound('评论');
  if (r.user_id !== userId) throw new HttpError(403, 'forbidden', '只能删除自己的评论');
  deps.db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
}
