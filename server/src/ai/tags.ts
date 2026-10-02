import { z } from 'zod';
import { row, rows, type Deps } from '../http.ts';
import { findInCatalog } from './catalog.ts';
import { inferMoods, isMood, MOOD_LIST, uniqMoods, type Mood } from './moods.ts';
import { localHour } from './time.ts';

/**
 * 歌曲情绪标签。来源优先级：ai（大模型）> catalog（曲库已标注）> rule（从听众写的感受里推断）。
 * 存在 song_moods 表里，按歌（而不是按地点记录）存，同一首歌在不同地点共用。
 */

function store(deps: Deps, songId: string, moods: Mood[], source: 'ai' | 'catalog' | 'rule') {
  if (moods.length === 0) return;
  const now = deps.now().toISOString();
  deps.db.prepare('DELETE FROM song_moods WHERE song_id = ? AND source = ?').run(songId, source);
  const ins = deps.db.prepare(
    'INSERT OR IGNORE INTO song_moods (song_id, mood, source, created_at) VALUES (?, ?, ?, ?)',
  );
  for (const m of moods) ins.run(songId, m, source, now);
}

/** 同步打标签（曲库 / 规则），在新增歌曲记录时调用。 */
export function tagSongSync(deps: Deps, songId: string, title: string, artist: string, note?: string | null) {
  const hit = findInCatalog(title, artist);
  if (hit) store(deps, songId, hit.moods, 'catalog');
  const fromNote = uniqMoods(inferMoods(note), 2);
  if (fromNote.length) {
    const existing = rows<{ mood: string }>(
      deps.db.prepare("SELECT mood FROM song_moods WHERE song_id = ? AND source = 'rule'").all(songId),
    ).map((r) => r.mood);
    store(deps, songId, uniqMoods([...existing, ...fromNote], 3), 'rule');
  }
}

const aiTagSchema = z.object({ moods: z.array(z.string()).min(1).max(3) });

/** 让大模型给歌打标签（异步，失败静默）。已有 ai 标签的歌不重复调用。 */
export async function tagSongWithAi(deps: Deps, songId: string, title: string, artist: string, note?: string | null) {
  if (!deps.llm) return;
  const has = row(deps.db.prepare("SELECT 1 AS x FROM song_moods WHERE song_id = ? AND source = 'ai'").get(songId));
  if (has) return;
  try {
    const out = await deps.llm.json(
      aiTagSchema,
      [
        {
          role: 'system',
          content: `你是音乐编辑。根据歌曲给出 1-3 个情绪标签，只能从这个词表里选：${MOOD_LIST.join('、')}。只输出 JSON：{"moods":["…"]}`,
        },
        { role: 'user', content: `歌曲：《${title}》- ${artist}${note ? `\n有听众在某个地点写下的感受：${note}` : ''}` },
      ],
      { timeoutMs: 8000, temperature: 0.2 },
    );
    store(deps, songId, uniqMoods(out.moods.filter(isMood), 3), 'ai');
  } catch {
    /* 降级：保留曲库/规则标签 */
  }
}

/** 批量取歌曲情绪：ai 优先，否则曲库，再否则规则。 */
export function songMoods(deps: Deps, songIds: string[]): Map<string, Mood[]> {
  const out = new Map<string, Mood[]>();
  if (songIds.length === 0) return out;
  const marks = songIds.map(() => '?').join(',');
  const found = rows<{ song_id: string; mood: string; source: string }>(
    deps.db.prepare(`SELECT song_id, mood, source FROM song_moods WHERE song_id IN (${marks})`).all(...songIds),
  );
  const rank: Record<string, number> = { ai: 0, catalog: 1, rule: 2 };
  const bySong = new Map<string, { mood: string; source: string }[]>();
  for (const r of found) (bySong.get(r.song_id) ?? bySong.set(r.song_id, []).get(r.song_id)!).push(r);
  for (const [id, list] of bySong) {
    const best = Math.min(...list.map((r) => rank[r.source] ?? 9));
    const primary = list.filter((r) => rank[r.source] === best).map((r) => r.mood);
    const rest = list.filter((r) => rank[r.source] !== best).map((r) => r.mood);
    out.set(id, uniqMoods([...primary, ...rest], 3));
  }
  return out;
}

/**
 * 每条地点歌曲记录的「活跃时段」直方图（按本地小时）：来自「我也在听」和点赞的时间。
 * 用来回答「这首歌在这里通常什么时候被听」。
 */
export function placeSongHours(deps: Deps, placeSongIds: string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (placeSongIds.length === 0) return out;
  const marks = placeSongIds.map(() => '?').join(',');
  const events = rows<{ id: string; at: string }>(
    deps.db
      .prepare(
        `SELECT place_song_id AS id, created_at AS at FROM listens WHERE place_song_id IN (${marks})
         UNION ALL
         SELECT place_song_id AS id, created_at AS at FROM votes WHERE value = 1 AND place_song_id IN (${marks})`,
      )
      .all(...placeSongIds, ...placeSongIds),
  );
  for (const e of events) {
    const h = localHour(new Date(e.at), deps.tz);
    const hist = out.get(e.id) ?? out.set(e.id, new Array(24).fill(0)).get(e.id)!;
    hist[h]!++;
  }
  return out;
}

const pending = new Set<Promise<void>>();

/** 在后台打 AI 标签（不阻塞请求）；任务登记在案，便于测试或优雅退出时等待。 */
export function tagInBackground(deps: Deps, songId: string, title: string, artist: string, note?: string | null) {
  if (!deps.llm) return;
  const p: Promise<void> = tagSongWithAi(deps, songId, title, artist, note).finally(() => pending.delete(p));
  pending.add(p);
}

/** 等待所有后台打标签任务完成。 */
export async function backgroundIdle() {
  while (pending.size) await Promise.allSettled([...pending]);
}
