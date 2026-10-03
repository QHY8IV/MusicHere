/**
 * 共鸣模式的信号处理（纯函数，不依赖浏览器，可单元测试）：
 *
 * - 节奏：对「起音强度」序列做自相关，找出环境里的拍子周期（BPM）与相位（最近一拍在什么时候）；
 * - 调性：把频谱的峰值折叠成 12 个音级（chroma），判断环境里是一个持续的嗡鸣音（drone），
 *   还是一段有调性的音乐（用 Krumhansl–Schmuckler 调性轮廓匹配 24 个调）；
 * - 决策：歌曲该怎么移调、该用哪个倍速，才能和环境同拍、同调。
 */

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;
export type Mode = 'major' | 'minor';
export interface Key {
  tonic: number;
  mode: Mode;
}

export const pcName = (pc: number) => NOTE_NAMES[((pc % 12) + 12) % 12]!;
export const keyName = (k: Key) => `${pcName(k.tonic)} ${k.mode === 'major' ? '大调' : '小调'}`;
/** 把半音数收进 [-6, 5]，移调走最近的方向。 */
export const wrapSemis = (s: number) => ((((s + 6) % 12) + 12) % 12) - 6;

// ---------------------------------------------------------------- 节奏

export interface TempoEstimate {
  bpm: number;
  /** 周期（帧） */
  period: number;
  /** 0–1：自相关峰值的归一化高度 */
  confidence: number;
}

/** 三点平滑 + 去均值 */
function prepare(onset: ArrayLike<number>): Float64Array {
  const n = onset.length;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = onset[Math.max(0, i - 1)]!;
    const b = onset[i]!;
    const c = onset[Math.min(n - 1, i + 1)]!;
    x[i] = 0.25 * a + 0.5 * b + 0.25 * c;
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i]!;
  mean /= n || 1;
  for (let i = 0; i < n; i++) x[i]! -= mean;
  return x;
}

function autocorr(x: Float64Array, lag: number): number {
  let s = 0;
  const n = x.length - lag;
  for (let i = 0; i < n; i++) s += x[i]! * x[i + lag]!;
  return n > 0 ? s / n : 0;
}

/**
 * 从起音强度序列估计速度。fps 是序列的帧率（每秒多少个值）。
 * 为了避开「快一倍 / 慢一倍」的歧义，打分同时看 L 与 2L 处的相关性，并轻微偏好 prefBpm 附近的速度。
 */
export function estimateTempo(
  onset: ArrayLike<number>,
  fps: number,
  opts: { minBpm?: number; maxBpm?: number; prefBpm?: number } = {},
): TempoEstimate | null {
  const { minBpm = 60, maxBpm = 180, prefBpm = 110 } = opts;
  const x = prepare(onset);
  const r0 = autocorr(x, 0);
  if (r0 <= 1e-12) return null;
  const lo = Math.max(2, Math.floor((fps * 60) / maxBpm));
  const hi = Math.min(Math.floor(x.length / 2), Math.ceil((fps * 60) / minBpm));
  if (hi <= lo + 2) return null;

  const r = new Float64Array(2 * hi + 2);
  const at = (l: number) => {
    if (l >= r.length || l >= x.length) return 0;
    if (r[l] === 0) r[l] = autocorr(x, l) / r0 || 1e-15;
    return r[l]!;
  };

  let best = -1;
  let bestScore = -Infinity;
  for (let l = lo; l <= hi; l++) {
    const v = at(l);
    // 只考虑局部峰
    if (!(v >= at(l - 1) && v >= at(l + 1))) continue;
    const bpm = (60 * fps) / l;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / prefBpm) / 1.0) ** 2);
    const score = (v + 0.5 * Math.max(0, at(2 * l))) * (0.6 + 0.4 * prior);
    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  }
  if (best < 0) return null;

  // 强弱交替的拍子（左右脚、强拍弱拍）会让两拍的周期比一拍更「像」周期：
  // 如果一半的滞后处也有足够高的峰，说明真正的拍子更短
  for (;;) {
    const half = Math.round(best / 2);
    if (half < lo) break;
    let h = half;
    for (const c of [half - 1, half + 1]) if (c >= lo && c < best && at(c) > at(h)) h = c;
    if (h < best && at(h) >= 0.6 * at(best) && at(h) > 0.15) best = h;
    else break;
  }

  // 抛物线插值得到小数周期
  const a = at(best - 1);
  const b = at(best);
  const c = at(best + 1);
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  const period = best + shift;
  return { bpm: (60 * fps) / period, period, confidence: Math.max(0, Math.min(1, b)) };
}

/**
 * 相位：最近的一拍距离序列末尾多少帧。把周期为 period 的「梳子」在 [0, period) 里滑动，
 * 取落在起音上最多的位置；越近的拍子权重越大，以便跟上缓慢的变化。
 */
export function estimatePhase(onset: ArrayLike<number>, period: number, beats = 8): number {
  const n = onset.length;
  const steps = Math.max(1, Math.round(period));
  let bestPhi = 0;
  let bestScore = -Infinity;
  const score = (phi: number) => {
    let s = 0;
    let w = 1;
    for (let k = 0; k < beats; k++) {
      const idx = Math.round(n - 1 - phi - k * period);
      if (idx < 1) break;
      // 允许 ±1 帧误差
      s += w * Math.max(onset[idx]!, 0.5 * onset[idx - 1]!, 0.5 * (onset[idx + 1] ?? 0));
      w *= 0.85;
    }
    return s;
  };
  for (let phi = 0; phi < steps; phi++) {
    const s = score(phi);
    if (s > bestScore) {
      bestScore = s;
      bestPhi = phi;
    }
  }
  return bestPhi;
}

/**
 * 歌曲该用环境速度的几倍：走路 56 步/分钟的「慢拍」配一首 112 BPM 的歌时取 2 倍，
 * 让歌曲的速度尽量接近它原本的速度（听感最自然）。
 */
export function fitTempo(envBpm: number, songBpm: number): { bpm: number; ratio: number } {
  let best = { bpm: envBpm, ratio: 1 };
  for (const ratio of [0.5, 1, 2]) {
    const bpm = envBpm * ratio;
    if (bpm < 55 || bpm > 190) continue;
    if (Math.abs(Math.log2(bpm / songBpm)) < Math.abs(Math.log2(best.bpm / songBpm))) best = { bpm, ratio };
  }
  return best;
}

/** 一个拍点相对环境拍子网格的偏差（秒），落在 (-P/2, P/2]。 */
export function gridError(beatTime: number, envBeat: number, envPeriod: number): number {
  const k = Math.round((beatTime - envBeat) / envPeriod);
  return envBeat + k * envPeriod - beatTime;
}

// ---------------------------------------------------------------- 调性

/**
 * 把 AnalyserNode 的分贝频谱折叠为 12 个音级的能量分布（总和为 1）。
 * 只取局部峰值，并用抛物线插值求准频率，避免宽带噪声把所有音级抹平。
 */
export function chromaFromSpectrum(
  db: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  opts: { fmin?: number; fmax?: number; range?: number } = {},
): number[] {
  const { fmin = 65, fmax = 2100, range = 40 } = opts;
  const binHz = sampleRate / fftSize;
  const k0 = Math.max(2, Math.floor(fmin / binHz));
  const k1 = Math.min(db.length - 2, Math.ceil(fmax / binHz));
  let max = -Infinity;
  for (let k = k0; k <= k1; k++) max = Math.max(max, db[k]!);
  const chroma = new Array<number>(12).fill(0);
  if (!Number.isFinite(max) || max < -100) return chroma;
  const thr = max - range;
  for (let k = k0; k <= k1; k++) {
    const b = db[k]!;
    if (b < thr || !(b > db[k - 1]! && b >= db[k + 1]!)) continue;
    const a = db[k - 1]!;
    const c = db[k + 1]!;
    const d = a - 2 * b + c;
    const p = d !== 0 ? (0.5 * (a - c)) / d : 0;
    const f = (k + p) * binHz;
    const midi = 69 + 12 * Math.log2(f / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    // 越接近十二平均律的音越可信
    const cents = Math.abs(midi - Math.round(midi));
    chroma[pc]! += 10 ** ((b - max) / 20) * (1 - cents);
  }
  const sum = chroma.reduce((s, v) => s + v, 0);
  return sum > 0 ? chroma.map((v) => v / sum) : chroma;
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let dbb = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    dbb += (b[i]! - mb) ** 2;
  }
  return da && dbb ? num / Math.sqrt(da * dbb) : 0;
}

/** Krumhansl–Schmuckler：和 24 个调的轮廓逐一求相关，返回最像的调与相关系数。 */
export function estimateKey(chroma: number[]): { key: Key; score: number; margin: number } {
  const scores: { key: Key; score: number }[] = [];
  for (let t = 0; t < 12; t++) {
    for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]] as const) {
      const rotated = prof.map((_, i) => prof[(i - t + 12) % 12]!);
      scores.push({ key: { tonic: t, mode }, score: pearson(chroma, rotated) });
    }
  }
  scores.sort((a, b) => b.score - a.score);
  return { key: scores[0]!.key, score: scores[0]!.score, margin: scores[0]!.score - scores[1]!.score };
}

export type Tonality =
  | { kind: 'drone'; pc: number; strength: number }
  | { kind: 'key'; key: Key; strength: number }
  | { kind: 'none' };

/**
 * 环境里有没有「调」：一个音级明显压过其他（发动机、风铃、空调的嗡鸣）→ drone；
 * 能量分散但和某个调的轮廓高度相关（街头艺人在弹琴）→ key；否则 none。
 */
export function detectTonality(chroma: number[]): Tonality {
  const sum = chroma.reduce((s, v) => s + v, 0);
  if (sum <= 0) return { kind: 'none' };
  let top = 0;
  for (let i = 1; i < 12; i++) if (chroma[i]! > chroma[top]!) top = i;
  const share = chroma[top]! / sum;
  if (share >= 0.4) return { kind: 'drone', pc: top, strength: share };
  const est = estimateKey(chroma);
  if (est.score >= 0.65 && est.margin >= 0.03) return { kind: 'key', key: est.key, strength: est.score };
  return { kind: 'none' };
}

/**
 * 歌曲该移几个半音、用什么调式：
 * - 环境是一个嗡鸣音：让它成为新调的主音或属音（选移动最少的那个）；调式不变。
 * - 环境是一个调：直接移到这个调，调式也跟着环境走。
 */
export function chooseTranspose(song: Key, env: Tonality): { semis: number; mode: Mode; role: '主音' | '属音' | '同调' } | null {
  if (env.kind === 'none') return null;
  if (env.kind === 'key') {
    return { semis: wrapSemis(env.key.tonic - song.tonic), mode: env.key.mode, role: '同调' };
  }
  const asTonic = wrapSemis(env.pc - song.tonic);
  const asFifth = wrapSemis(env.pc - 7 - song.tonic);
  return Math.abs(asTonic) <= Math.abs(asFifth)
    ? { semis: asTonic, mode: song.mode, role: '主音' }
    : { semis: asFifth, mode: song.mode, role: '属音' };
}

/** 指数平滑一个 chroma 向量（原地更新并返回）。 */
export function smoothChroma(acc: number[], next: number[], alpha: number): number[] {
  for (let i = 0; i < 12; i++) acc[i] = acc[i]! * (1 - alpha) + next[i]! * alpha;
  return acc;
}
