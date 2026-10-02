import { z } from 'zod';
import type { Deps } from '../http.ts';
import { isSuppressed, proximityFactor } from '../ranking.ts';
import { placeRowsNear, placesNear, type PlaceDto } from '../services/places.ts';
import { listPlaceSongs, type PlaceSongDto } from '../services/placeSongs.ts';
import { CATALOG } from './catalog.ts';
import { LlmError } from './llm.ts';
import {
  CATEGORY_MOODS,
  centroid,
  inferMoods,
  isMood,
  MOOD_LIST,
  MOODS,
  moodSimilarity,
  moodsForHour,
  uniqMoods,
  type Mood,
} from './moods.ts';
import { crowdReason, timeShare } from './reasons.ts';
import { placeSongHours, songMoods } from './tags.ts';
import { timeLabel } from './time.ts';

/**
 * 「拍一下，听这里」：读懂此刻（画面 + 一句话 + 时间 + 地点），再结合这里的人群记忆挑歌。
 *
 * 1. 场景理解：有大模型时用多模态模型看图；否则用规则引擎（文字关键词 + 画面色调 + 时段 + 地点类型）。
 * 2. 推荐：先从附近地点里人们留下的歌中挑（情绪匹配 × 社区权重 × 距离 × 时段），
 *    不足时由 AI 补位——这就是新地点的冷启动。
 * 3. 每首歌都附可解释的推荐理由，理由只引用真实数据。
 */

export interface ColorHint {
  /** 0 暗 → 1 亮 */
  brightness: number;
  /** -1 冷 → 1 暖 */
  warmth: number;
  /** 0 灰 → 1 艳 */
  saturation: number;
}

export interface SceneInput {
  text?: string | undefined;
  /** 不含 data: 前缀的 base64 */
  imageBase64?: string | undefined;
  imageMime?: string | undefined;
  colorHint?: ColorHint | undefined;
  lat: number;
  lng: number;
  /** 用户本地时间的小时（0–23） */
  hour: number;
}

export interface Scene {
  summary: string;
  moods: Mood[];
  tags: string[];
  energy: number;
  valence: number;
  timeLabel: string;
}

export type ScenePick =
  | {
      source: 'crowd';
      placeSong: PlaceSongDto;
      place: { id: string; name: string; distanceM: number };
      matched: Mood[];
      reason: string;
    }
  | {
      source: 'ai';
      song: { title: string; artist: string };
      matched: Mood[];
      reason: string;
    };

export interface SceneResult {
  engine: { kind: 'llm' | 'rules'; label: string };
  scene: Scene;
  place: PlaceDto | null;
  picks: ScenePick[];
  /** 附近还没有任何人分享过歌，全部推荐来自 AI */
  coldStart: boolean;
}

const RADIUS_M = 400;
const MAX_PICKS = 5;

// ---------- 场景理解：规则引擎 ----------

function colorMoods(c: ColorHint): { moods: Mood[]; tag: string } {
  if (c.brightness < 0.28) return { moods: ['夜色', '静谧'], tag: '夜色低光' };
  if (c.warmth > 0.25 && c.brightness < 0.7) return { moods: ['浪漫', '惬意'], tag: '暖调光线' };
  if (c.saturation > 0.45 && c.brightness > 0.55) return { moods: ['欢快', '清新'], tag: '明亮鲜艳' };
  if (c.saturation < 0.18) return { moods: ['静谧', '怀旧'], tag: '低饱和' };
  if (c.warmth < -0.2) return { moods: ['清新', '静谧'], tag: '冷色调' };
  return { moods: ['惬意'], tag: '柔和光线' };
}

function rulesScene(input: SceneInput, place: PlaceDto | null, crowdMoods: Mood[]): Scene {
  const score = new Map<Mood, number>();
  const add = (moods: Mood[], w: number) =>
    moods.forEach((m, i) => score.set(m, (score.get(m) ?? 0) + w * (1 - i * 0.15)));

  const textMoods = inferMoods(input.text);
  add(textMoods, 3);
  const tags: string[] = [timeLabel(input.hour)];
  if (input.colorHint) {
    const c = colorMoods(input.colorHint);
    add(c.moods, 2);
    tags.push(c.tag);
  }
  add(crowdMoods, 1.5);
  if (place?.category) add(CATEGORY_MOODS[place.category] ?? [], 1);
  add(moodsForHour(input.hour), 1.2);

  const moods = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m).slice(0, 3);
  if (place) tags.push(place.name);
  const textHint = input.text?.trim() ? `“${input.text.trim().slice(0, 20)}”，` : '';
  const where = place ? `在${place.name}` : '在这里';
  const c = centroid(moods);
  return {
    summary: `${timeLabel(input.hour)}，${where}。${textHint}此刻适合「${moods.slice(0, 2).join('」「')}」的歌。`,
    moods,
    tags: tags.slice(0, 4),
    energy: round2(c.energy),
    valence: round2(c.valence),
    timeLabel: timeLabel(input.hour),
  };
}

// ---------- 场景理解：大模型 ----------

const llmSceneSchema = z.object({
  summary: z.string().min(1).max(120),
  moods: z.array(z.string()).min(1).max(5),
  tags: z.array(z.string().max(12)).max(6).default([]),
  energy: z.number().min(0).max(1),
  valence: z.number().min(0).max(1),
  songs: z
    .array(z.object({ title: z.string().min(1).max(80), artist: z.string().min(1).max(80), why: z.string().max(60).default('') }))
    .max(5)
    .default([]),
});

async function llmScene(
  deps: Deps,
  input: SceneInput,
  place: PlaceDto | null,
  crowdTop: PlaceSongDto[],
): Promise<{ scene: Scene; songs: { title: string; artist: string; why: string }[] }> {
  const context = [
    `本地时间：${input.hour} 点（${timeLabel(input.hour)}）`,
    place ? `所在地点：${place.name}${place.category ? `（${place.category}）` : ''}` : '所在地点：未命名的地方',
    crowdTop.length
      ? `这里的人们留下过的歌：${crowdTop.slice(0, 6).map((s) => `《${s.song.title}》${s.song.artist}`).join('、')}`
      : '这里还没有人留下过歌。',
    input.text?.trim() ? `用户描述此刻：${input.text.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const system = `你是 MusicHere 的场景音乐编辑，擅长从画面和描述里读出氛围并为当下挑歌。
请输出 JSON，字段：
- summary：一句话描述此刻的场景氛围（30 字以内，具体、有画面感，不要空话）
- moods：1-3 个情绪，只能从词表选：${MOOD_LIST.join('、')}
- tags：2-4 个画面/环境标签（如「晚霞」「江风」「人群」，每个 2-4 字）
- energy：0-1，画面与心情的能量感；valence：0-1，情绪的明亮程度
- songs：3 首真实存在、适合此刻的歌，{title, artist, why}，why 为 20 字以内的推荐理由
只输出 JSON。`;

  const hasImage = !!input.imageBase64;
  const userContent = hasImage
    ? [
        { type: 'text' as const, text: `${context}\n请看这张此刻拍下的照片。` },
        { type: 'image_url' as const, image_url: { url: `data:${input.imageMime ?? 'image/jpeg'};base64,${input.imageBase64}` } },
      ]
    : context;

  const out = await deps.llm!.json(
    llmSceneSchema,
    [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    { vision: hasImage, temperature: 0.7 },
  );

  let moods = uniqMoods(out.moods.filter(isMood), 3);
  if (moods.length === 0) moods = [nearestMood(out.energy, out.valence)];
  return {
    scene: {
      summary: out.summary,
      moods,
      tags: out.tags.slice(0, 4),
      energy: round2(out.energy),
      valence: round2(out.valence),
      timeLabel: timeLabel(input.hour),
    },
    songs: out.songs,
  };
}

function nearestMood(energy: number, valence: number): Mood {
  let best: Mood = '惬意';
  let bestD = Infinity;
  for (const m of MOOD_LIST) {
    const d = Math.hypot(MOODS[m].energy - energy, MOODS[m].valence - valence);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- 主流程 ----------

export async function analyzeScene(deps: Deps, userId: string, input: SceneInput): Promise<SceneResult> {
  const near = placeRowsNear(deps, input.lat, input.lng, RADIUS_M);
  const nearbyDtos = placesNear(deps, input.lat, input.lng, RADIUS_M, 1, userId);
  const place = nearbyDtos.find((p) => p.distanceM !== null && p.distanceM <= p.radiusM) ?? null;

  const distanceByPlace = new Map(near.map((n) => [n.place.id, n]));
  const candidates = listPlaceSongs(deps, { placeIds: near.map((n) => n.place.id), userId }).filter(
    (s) => s.myVote !== -1 && !isSuppressed(s.likes, s.dislikes),
  );
  const moodsBySong = songMoods(deps, [...new Set(candidates.map((c) => c.song.id))]);
  const hoursByPs = placeSongHours(deps, candidates.map((c) => c.id));

  // 此地人群记忆里最主要的情绪，作为规则引擎的一路信号
  const crowdMoodScore = new Map<Mood, number>();
  for (const c of candidates.filter((c) => !place || c.placeId === place.id)) {
    for (const m of moodsBySong.get(c.song.id) ?? []) crowdMoodScore.set(m, (crowdMoodScore.get(m) ?? 0) + c.weight);
  }
  const crowdMoods = [...crowdMoodScore.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m).slice(0, 2);

  let engine: SceneResult['engine'] = { kind: 'rules', label: '本地规则引擎' };
  let scene: Scene;
  let llmSongs: { title: string; artist: string; why: string }[] = [];
  if (deps.llm) {
    try {
      const r = await llmScene(deps, input, place, candidates.slice(0, 6));
      scene = r.scene;
      llmSongs = r.songs;
      engine = { kind: 'llm', label: deps.llm.label };
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      scene = rulesScene(input, place, crowdMoods);
    }
  } else {
    scene = rulesScene(input, place, crowdMoods);
  }

  // ---- 人群记忆里挑歌 ----
  const scored = candidates.map((ps) => {
    const n = distanceByPlace.get(ps.placeId)!;
    const sm = moodsBySong.get(ps.song.id) ?? [];
    const sim = moodSimilarity(scene.moods, sm);
    const hours = hoursByPs.get(ps.id);
    const timeBoost = 1 + 0.5 * (hours ? timeShare(hours, input.hour) : 0);
    const score = ps.weight * proximityFactor(n.distanceM, n.place.radius_m) * (0.35 + sim) * timeBoost;
    return { ps, n, sm, hours, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const picks: ScenePick[] = [];
  const usedSongs = new Set<string>();
  const usedKeys = new Set<string>();
  const keyOf = (t: string, a: string) => `${t.trim().toLowerCase()}|${a.trim().toLowerCase()}`;
  for (const s of scored) {
    if (picks.length >= MAX_PICKS - 1) break; // 至少给 AI 留一个位置
    if (usedSongs.has(s.ps.song.id)) continue;
    usedSongs.add(s.ps.song.id);
    usedKeys.add(keyOf(s.ps.song.title, s.ps.song.artist));
    const matched = s.sm.filter((m) => scene.moods.includes(m));
    picks.push({
      source: 'crowd',
      placeSong: s.ps,
      place: { id: s.n.place.id, name: s.n.place.name, distanceM: Math.round(s.n.distanceM) },
      matched,
      reason: crowdReason(s.ps, { matched, hour: input.hour, hours: s.hours }),
    });
  }

  // ---- AI 补位 / 冷启动 ----
  const aiSlots = Math.max(1, MAX_PICKS - picks.length);
  const aiPicks: ScenePick[] = [];
  for (const s of llmSongs) {
    if (aiPicks.length >= aiSlots) break;
    const k = keyOf(s.title, s.artist);
    if (usedKeys.has(k)) continue;
    usedKeys.add(k);
    aiPicks.push({
      source: 'ai',
      song: { title: s.title, artist: s.artist },
      matched: scene.moods.slice(0, 2),
      reason: s.why || `为此刻的「${scene.moods.slice(0, 2).join('·')}」挑选`,
    });
  }
  if (aiPicks.length < aiSlots) {
    const ranked = CATALOG.map((c) => ({
      c,
      score: moodSimilarity(scene.moods, c.moods) + deps.rng() * 0.25,
    })).sort((a, b) => b.score - a.score);
    for (const { c } of ranked) {
      if (aiPicks.length >= aiSlots) break;
      const k = keyOf(c.title, c.artist);
      if (usedKeys.has(k)) continue;
      usedKeys.add(k);
      const matched = c.moods.filter((m) => scene.moods.includes(m));
      aiPicks.push({
        source: 'ai',
        song: { title: c.title, artist: c.artist },
        matched,
        reason: matched.length
          ? `${scene.timeLabel}的「${matched.join('·')}」，适合这首`
          : `${scene.timeLabel}的氛围，适合这首`,
      });
    }
  }

  return {
    engine,
    scene,
    place,
    picks: [...picks, ...aiPicks],
    coldStart: candidates.length === 0,
  };
}
