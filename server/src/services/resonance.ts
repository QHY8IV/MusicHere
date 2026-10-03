import { randomUUID } from 'node:crypto';
import { haversineM } from '../geo.ts';
import { HttpError, row, rows, type Deps } from '../http.ts';
import { checkinAllowanceM, getPlaceRow } from './places.ts';

/**
 * 共鸣指纹：一个地点「听起来」的拍子和调。
 *
 * 用户在现场开启共鸣模式时，手机在本机分析环境声（脚步、车轮、转向灯、街头艺人……），
 * 得到的只是几个数字——速度、置信度、主音 / 调式——由用户确认后贡献给这个地点。
 * 下一个人来到这里，歌曲一开始就按这里的拍子和调预调好；环境声本身从不上传。
 */

export type PrintMode = 'major' | 'minor' | 'drone';

export interface PrintInput {
  lat: number;
  lng: number;
  bpm: number;
  confidence: number;
  source: 'mic' | 'motion';
  tonic?: number | undefined;
  mode?: PrintMode | undefined;
}

export interface ResonanceSummary {
  count: number;
  /** 最近 50 条的中位数 */
  bpm: number | null;
  /** 出现最多的主音与调式 */
  tonic: number | null;
  mode: PrintMode | null;
  /** 该主音占有调性记录的比例 */
  keyShare: number;
  contributors: number;
  lastAt: string | null;
}

/** 速度只在一个八度里比较：60 和 120 是同一种拍子 */
function foldBpm(bpm: number): number {
  let b = bpm;
  while (b < 80) b *= 2;
  while (b >= 160) b /= 2;
  return b;
}

export function addPrint(deps: Deps, userId: string, placeId: string, input: PrintInput): ResonanceSummary {
  const place = getPlaceRow(deps, placeId);
  const distanceM = haversineM(input.lat, input.lng, place.lat, place.lng);
  const allowed = checkinAllowanceM(place.radius_m);
  if (distanceM > allowed) {
    throw new HttpError(403, 'too_far', '要在现场才能留下这里的共鸣指纹', { distanceM: Math.round(distanceM), allowedM: allowed });
  }
  if ((input.tonic === undefined) !== (input.mode === undefined)) {
    throw new HttpError(400, 'validation', '主音与调式需要同时提供');
  }
  // 同一个人在同一个地点 10 分钟内只记一次，避免刷量
  const recent = row(
    deps.db
      .prepare('SELECT 1 AS x FROM resonance_prints WHERE user_id = ? AND place_id = ? AND created_at > ?')
      .get(userId, placeId, new Date(deps.now().getTime() - 10 * 60_000).toISOString()),
  );
  if (!recent) {
    deps.db
      .prepare(
        `INSERT INTO resonance_prints (id, place_id, user_id, bpm, confidence, source, tonic, mode, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), placeId, userId, input.bpm, input.confidence, input.source, input.tonic ?? null, input.mode ?? null, deps.now().toISOString());
  }
  return resonanceSummary(deps, placeId);
}

export function resonanceSummary(deps: Deps, placeId: string): ResonanceSummary {
  getPlaceRow(deps, placeId);
  const list = rows<{ bpm: number; tonic: number | null; mode: PrintMode | null; user_id: string; created_at: string }>(
    deps.db
      .prepare('SELECT bpm, tonic, mode, user_id, created_at FROM resonance_prints WHERE place_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(placeId),
  );
  if (list.length === 0) {
    return { count: 0, bpm: null, tonic: null, mode: null, keyShare: 0, contributors: 0, lastAt: null };
  }
  const folded = list.map((p) => foldBpm(p.bpm)).sort((a, b) => a - b);
  const mid = folded.length >> 1;
  const median = folded.length % 2 ? folded[mid]! : (folded[mid - 1]! + folded[mid]!) / 2;

  const keyed = list.filter((p) => p.tonic !== null && p.mode !== null);
  const votes = new Map<string, number>();
  for (const p of keyed) votes.set(`${p.tonic}|${p.mode}`, (votes.get(`${p.tonic}|${p.mode}`) ?? 0) + 1);
  const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const [tonic, mode] = top ? top[0].split('|') : [null, null];

  const total = row<{ n: number }>(deps.db.prepare('SELECT COUNT(*) AS n FROM resonance_prints WHERE place_id = ?').get(placeId))!.n;
  return {
    count: total,
    bpm: Math.round(median * 10) / 10,
    tonic: tonic === null || tonic === undefined ? null : Number(tonic),
    mode: (mode as PrintMode | undefined) ?? null,
    keyShare: top ? Math.round((top[1] / keyed.length) * 100) / 100 : 0,
    contributors: new Set(list.map((p) => p.user_id)).size,
    lastAt: list[0]!.created_at,
  };
}
