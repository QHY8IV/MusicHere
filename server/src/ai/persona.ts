import { z } from 'zod';
import { rows, type Deps } from '../http.ts';
import { getPlaceRow } from '../services/places.ts';
import { listPlaceSongs, type PlaceSongDto } from '../services/placeSongs.ts';
import { LlmError } from './llm.ts';
import type { Mood } from './moods.ts';
import { songMoods } from './tags.ts';
import { localHour, peakWindow, windowLabel } from './time.ts';

/**
 * 地点「声音画像」：把一个地方所有人留下的歌、评论、打卡时段聚合起来，
 * 由大模型写成一句有温度的描述（没有大模型时用模板），回答「这里听起来是什么样的」。
 *
 * 统计部分全部来自真实数据；模型只负责措辞。结果按数据签名缓存，数据不变就不重复调用模型。
 */

export interface Persona {
  engine: { kind: 'llm' | 'rules'; label: string };
  summary: string;
  keywords: string[];
  moods: { mood: Mood; share: number }[];
  /** 24 小时活跃度（打卡、在听、点赞、评论） */
  hours: number[];
  peak: { startHour: number; label: string } | null;
  topArtists: string[];
  counts: { songs: number; live: number; visitors: number; comments: number };
  generatedAt: string;
}

const cache = new WeakMap<object, Map<string, { sig: string; persona: Persona }>>();

const llmPersonaSchema = z.object({
  summary: z.string().min(4).max(80),
  keywords: z.array(z.string().min(1).max(8)).min(1).max(4),
});

export async function placePersona(deps: Deps, placeId: string): Promise<Persona> {
  const place = getPlaceRow(deps, placeId);
  const songs = listPlaceSongs(deps, { placeId, userId: null });
  const moods = moodShares(deps, songs);

  // 活跃时段
  const events = rows<{ at: string }>(
    deps.db
      .prepare(
        `SELECT created_at AS at FROM checkins WHERE place_id = ?
         UNION ALL SELECT c.created_at FROM comments c WHERE c.place_id = ?
         UNION ALL SELECT l.created_at FROM listens l JOIN place_songs ps ON ps.id = l.place_song_id WHERE ps.place_id = ?
         UNION ALL SELECT v.created_at FROM votes v JOIN place_songs ps ON ps.id = v.place_song_id WHERE ps.place_id = ? AND v.value = 1`,
      )
      .all(placeId, placeId, placeId, placeId),
  );
  const hours = new Array<number>(24).fill(0);
  for (const e of events) hours[localHour(new Date(e.at), deps.tz)]!++;
  const peakStart = peakWindow(hours);
  const peak = peakStart === null ? null : { startHour: peakStart, label: windowLabel(peakStart) };

  // 常被留下的艺人
  const artistScore = new Map<string, number>();
  for (const s of songs) artistScore.set(s.song.artist, (artistScore.get(s.song.artist) ?? 0) + s.weight);
  const topArtists = [...artistScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);

  const counts = {
    songs: songs.length,
    live: songs.filter((s) => s.kind === 'live').length,
    visitors: (rows<{ n: number }>(deps.db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM checkins WHERE place_id = ?').all(placeId))[0]?.n) ?? 0,
    comments: (rows<{ n: number }>(deps.db.prepare('SELECT COUNT(*) AS n FROM comments WHERE place_id = ?').all(placeId))[0]?.n) ?? 0,
  };

  const sig = JSON.stringify([counts, moods, peakStart, topArtists, songs.reduce((a, s) => a + s.likes + s.listeners, 0)]);
  let perPlace = cache.get(deps.db);
  if (!perPlace) cache.set(deps.db, (perPlace = new Map()));
  const hit = perPlace.get(placeId);
  if (hit && hit.sig === sig) return hit.persona;

  const base = { moods, hours, peak, topArtists, counts, generatedAt: deps.now().toISOString() };
  let persona: Persona = { ...base, ...rulesWording(place.name, moods.map((m) => m.mood), peak?.label ?? null, topArtists, counts), engine: { kind: 'rules', label: '本地规则引擎' } };

  if (deps.llm && songs.length > 0) {
    try {
      const comments = rows<{ body: string }>(
        deps.db.prepare('SELECT body FROM comments WHERE place_id = ? ORDER BY created_at DESC LIMIT 8').all(placeId),
      ).map((c) => c.body);
      const out = await deps.llm.json(
        llmPersonaSchema,
        [
          {
            role: 'system',
            content:
              '你是一位懂音乐也懂城市的编辑。根据一个地点的聚合数据，为它写「声音画像」。只输出 JSON：{"summary":"30 字以内、具体有画面感的一句话，可以提到时段和代表性的歌/艺人，不要编造数据里没有的事实","keywords":["3 个 2-4 字的关键词"]}',
          },
          {
            role: 'user',
            content: JSON.stringify({
              地点: place.name,
              描述: place.description,
              情绪构成: moods.map((m) => `${m.mood}${Math.round(m.share * 100)}%`),
              最热闹的时段: peak?.label ?? '数据不足',
              常被留下的艺人: topArtists,
              代表歌曲: songs.slice(0, 6).map((s) => `《${s.song.title}》${s.song.artist}（${s.kind === 'live' ? '现场' : s.kind === 'frequent' ? '常听' : '应景'}）`),
              听众的话: [...songs.map((s) => s.note).filter(Boolean).slice(0, 5), ...comments],
              统计: counts,
            }),
          },
        ],
        { timeoutMs: 10_000, temperature: 0.8 },
      );
      persona = { ...base, summary: out.summary, keywords: out.keywords.slice(0, 3), engine: { kind: 'llm', label: deps.llm.label } };
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
    }
  }

  perPlace.set(placeId, { sig, persona });
  return persona;
}

/** 情绪构成：按每条记录的推荐权重加权，取前 n 个。 */
export function moodShares(deps: Deps, songs: PlaceSongDto[], n = 4): { mood: Mood; share: number }[] {
  const moodsBySong = songMoods(deps, [...new Set(songs.map((s) => s.song.id))]);
  const moodScore = new Map<Mood, number>();
  for (const s of songs) {
    const ms = moodsBySong.get(s.song.id) ?? [];
    ms.forEach((m, i) => moodScore.set(m, (moodScore.get(m) ?? 0) + s.weight * (i === 0 ? 1 : 0.6)));
  }
  const totalMood = [...moodScore.values()].reduce((a, b) => a + b, 0) || 1;
  return [...moodScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([mood, v]) => ({ mood, share: Math.round((v / totalMood) * 100) / 100 }));
}

function rulesWording(
  name: string,
  moods: Mood[],
  peakLabel: string | null,
  artists: string[],
  counts: Persona['counts'],
): { summary: string; keywords: string[] } {
  if (counts.songs === 0) {
    return { summary: `${name}还很安静，等你留下第一首属于这里的歌。`, keywords: ['等待被发现'] };
  }
  const moodPart = moods.length >= 2 ? `「${moods[0]}」里带点「${moods[1]}」` : moods.length === 1 ? `「${moods[0]}」` : '说不清的味道';
  const peakPart = peakLabel ? `，${peakLabel}最热闹` : '';
  const artistPart = artists.length ? `；人们常在这里听${artists.slice(0, 2).join('、')}` : '';
  const livePart = counts.live > 0 ? `，也曾响起过 ${counts.live} 次现场` : '';
  const keywords = [...moods.slice(0, 2), peakLabel ? peakLabel.split(' ')[0]! : '', counts.live > 0 ? '有现场' : ''].filter(Boolean);
  return {
    summary: `${name}听起来是${moodPart}${peakPart}${artistPart}${livePart}。`,
    keywords: [...new Set(keywords)].slice(0, 3),
  };
}
