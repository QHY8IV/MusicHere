/**
 * 推荐权重。
 *
 * 一条「地点-歌曲」记录的权重由下面几项相乘得到：
 *
 *   kind     应景 / 常听 / 现场 的基础权重
 *   source   官方记录略高于用户上传
 *   vote     点赞取对数（边际递减，避免被刷榜），点踩线性压低
 *   listen   近 30 天「我也在听」的独立人数，主要影响「常听」
 *   fresh    时间衰减，但有下限——老歌曲在这个地方依然成立
 *
 * 权重既用于地点详情页的排序（取权重降序），也用于发现页的加权随机抽样。
 */

export type Kind = 'vibe' | 'frequent' | 'live';
export type Source = 'user' | 'official';

export interface RankInput {
  kind: Kind;
  source: Source;
  likes: number;
  dislikes: number;
  /** 近 30 天内去重后的「我也在听」人数 */
  listeners30d: number;
  /** 记录创建时间，或现场演出时间（更晚者），用于新鲜度 */
  referenceAt: Date;
  now: Date;
}

export const KIND_BASE: Record<Kind, number> = {
  vibe: 1,
  frequent: 1,
  live: 1.15,
};

const OFFICIAL_BOOST = 1.5;
const MIN_WEIGHT = 0.02;
const FRESH_FLOOR = 0.6;
const FRESH_HALF_LIFE_DAYS = 365;
const DAY_MS = 86_400_000;

export function songWeight(input: RankInput): number {
  const likes = Math.max(0, input.likes);
  const dislikes = Math.max(0, input.dislikes);
  const listeners = Math.max(0, input.listeners30d);

  const vote = (1 + Math.log(1 + likes)) / (1 + 0.6 * dislikes);
  const listen = 1 + 0.5 * Math.log(1 + listeners);
  const ageDays = Math.max(0, (input.now.getTime() - input.referenceAt.getTime()) / DAY_MS);
  const fresh = FRESH_FLOOR + (1 - FRESH_FLOOR) * 0.5 ** (ageDays / FRESH_HALF_LIFE_DAYS);
  const source = input.source === 'official' ? OFFICIAL_BOOST : 1;

  return Math.max(MIN_WEIGHT, KIND_BASE[input.kind] * source * vote * listen * fresh);
}

/**
 * 明显不受欢迎的记录：不再进入发现页的随机推荐，但仍然能在地点详情页里看到，
 * 这样被踩的歌不会直接「消失」，用户还能重新点赞翻盘。
 */
export function isSuppressed(likes: number, dislikes: number): boolean {
  return dislikes >= 3 && dislikes > 2 * likes;
}

/**
 * 距离衰减。用户在地点半径内视为 1；离开半径后按平方反比衰减（约 150m 降到一半）。
 */
export function proximityFactor(distanceM: number, placeRadiusM: number): number {
  const beyond = Math.max(0, distanceM - placeRadiusM);
  return 1 / (1 + (beyond / 150) ** 2);
}

/**
 * 加权无放回随机抽样（Efraimidis–Spirakis）：每项取 key = u^(1/w)，取 key 最大的 n 项。
 * rng 可注入，测试时传入确定性的随机源。
 */
export function weightedSample<T>(
  items: readonly { item: T; weight: number }[],
  n: number,
  rng: () => number = Math.random,
): T[] {
  return items
    .filter((x) => x.weight > 0)
    .map((x) => ({ item: x.item, key: Math.pow(Math.max(rng(), Number.EPSILON), 1 / x.weight) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, Math.max(0, n))
    .map((x) => x.item);
}
