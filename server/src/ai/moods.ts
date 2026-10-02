/**
 * 情绪词表：画面、文字、歌曲、地点都映射到同一套标签上，才能互相匹配。
 *
 * 每个情绪带一个二维坐标（能量 energy：安静→激烈，效价 valence：低落→明亮），
 * 用于计算两组情绪之间的相似度，也用于把大模型给出的坐标落回最近的标签。
 */
export const MOODS = {
  惬意: { energy: 0.35, valence: 0.72 },
  治愈: { energy: 0.28, valence: 0.78 },
  怀旧: { energy: 0.35, valence: 0.48 },
  浪漫: { energy: 0.42, valence: 0.76 },
  热血: { energy: 0.88, valence: 0.7 },
  欢快: { energy: 0.76, valence: 0.88 },
  静谧: { energy: 0.12, valence: 0.55 },
  孤独: { energy: 0.24, valence: 0.25 },
  伤感: { energy: 0.3, valence: 0.18 },
  自由: { energy: 0.62, valence: 0.78 },
  夜色: { energy: 0.45, valence: 0.42 },
  律动: { energy: 0.72, valence: 0.66 },
  清新: { energy: 0.5, valence: 0.82 },
  梦幻: { energy: 0.36, valence: 0.62 },
} as const;

export type Mood = keyof typeof MOODS;
export const MOOD_LIST = Object.keys(MOODS) as Mood[];

export const isMood = (s: string): s is Mood => Object.hasOwn(MOODS, s);

/**
 * 文字线索 → 情绪。用于：用户描述此刻、歌曲的一句话感受、评论。
 * 只收录高置信的词，宁缺毋滥；大模型可用时由大模型覆盖。
 */
const KEYWORDS: [RegExp, Mood[]][] = [
  [/日落|夕阳|黄昏|晚霞|傍晚/, ['浪漫', '惬意']],
  [/晚风|微风|江风|海风|吹风/, ['惬意', '自由']],
  [/下雨|小雨|雨天|雨夜|淋雨|雨/, ['伤感', '静谧']],
  [/深夜|凌晨|夜晚|夜里|霓虹|灯火|夜景|夜/, ['夜色']],
  [/一个人|独自|孤单|孤独|没人/, ['孤独']],
  [/分手|想你|失恋|难过|眼泪|哭/, ['伤感']],
  [/回忆|小时候|青春|那年|以前|当年|老歌|怀念/, ['怀旧']],
  [/约会|恋爱|喜欢的人|牵手|告白|心动|浪漫/, ['浪漫']],
  [/跑步|运动|健身|骑行|冲|燃|热血|球场/, ['热血', '律动']],
  [/开心|快乐|朋友|聚会|热闹|派对|周末/, ['欢快']],
  [/咖啡|书店|看书|午后|阳光|慵懒/, ['惬意', '治愈']],
  [/公园|树|草地|花|森林|清晨|早上|晨/, ['清新', '治愈']],
  [/安静|宁静|静静|发呆|放空/, ['静谧']],
  [/海|江|河|湖|天空|远方|旅行|公路|自由/, ['自由']],
  [/星|月亮|月光|梦|烟花|雪/, ['梦幻']],
  [/街头|吉他|合唱|演出|现场|livehouse|演唱会|乐队|鼓/i, ['律动', '热血']],
  [/地铁|通勤|下班|加班|上班/, ['夜色', '孤独']],
  [/治愈|温暖|温柔|舒服|放松/, ['治愈']],
];

/** 从一段文字里推断情绪，按命中次数排序。 */
export function inferMoods(text: string | null | undefined): Mood[] {
  if (!text) return [];
  const score = new Map<Mood, number>();
  for (const [re, moods] of KEYWORDS) {
    if (re.test(text)) for (const m of moods) score.set(m, (score.get(m) ?? 0) + 1);
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
}

/** 本地时间 → 时段情绪（没有任何其他线索时的兜底）。 */
export function moodsForHour(hour: number): Mood[] {
  if (hour >= 5 && hour < 9) return ['清新', '治愈'];
  if (hour >= 9 && hour < 12) return ['清新', '欢快'];
  if (hour >= 12 && hour < 16) return ['惬意', '治愈'];
  if (hour >= 16 && hour < 19) return ['浪漫', '惬意'];
  if (hour >= 19 && hour < 23) return ['夜色', '律动'];
  return ['静谧', '孤独'];
}

export const CATEGORY_MOODS: Record<string, Mood[]> = {
  street: ['自由', '律动'],
  park: ['清新', '治愈'],
  cafe: ['惬意', '治愈'],
  station: ['夜色', '律动'],
  campus: ['清新', '怀旧'],
  shop: ['欢快'],
  venue: ['热血', '律动'],
  landmark: ['浪漫', '自由'],
  other: [],
};

/** 两组情绪的相似度 ∈ [0,1]：标签重合 + 坐标接近，两者取较大。 */
export function moodSimilarity(a: readonly Mood[], b: readonly Mood[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const overlap = a.filter((m) => b.includes(m)).length / Math.min(a.length, b.length);
  const ca = centroid(a);
  const cb = centroid(b);
  const dist = Math.hypot(ca.energy - cb.energy, ca.valence - cb.valence);
  const closeness = Math.max(0, 1 - dist / 0.6);
  return Math.max(overlap, closeness * 0.8);
}

export function centroid(moods: readonly Mood[]): { energy: number; valence: number } {
  if (moods.length === 0) return { energy: 0.5, valence: 0.5 };
  let e = 0;
  let v = 0;
  for (const m of moods) {
    e += MOODS[m].energy;
    v += MOODS[m].valence;
  }
  return { energy: e / moods.length, valence: v / moods.length };
}

/** 去重并保持顺序，最多 n 个。 */
export function uniqMoods(list: readonly (Mood | string)[], n = 3): Mood[] {
  const out: Mood[] = [];
  for (const m of list) if (isMood(m) && !out.includes(m)) out.push(m);
  return out.slice(0, n);
}
