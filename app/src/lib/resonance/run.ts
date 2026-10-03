import { fitTempo, gridError } from './dsp';
import type { Song } from './songs';

/**
 * 跑步模式的纯逻辑：
 * - 按步频挑歌：伸缩最少的那首（「两步一拍」额外记一点代价，优先「一步一拍」）；
 * - 节拍引导：设了目标步频时，音乐比你的步子快（或慢）一点点，把你「带」过去——每次最多领先 3%；
 * - 合拍率：最近的落脚点有多少落在音乐的拍点上（±60 ms）。
 */

/**
 * 歌曲要伸缩多少（log2 比值的绝对值；0 = 不用伸缩）。
 * 「两步一拍」可以用，但跑起来不如「一步一拍」带劲，额外记约 3% 速度伸缩的代价。
 */
export function stretchCost(cadence: number, song: Song): number {
  const fit = fitTempo(cadence, song.bpm);
  return Math.abs(Math.log2(fit.bpm / song.bpm)) + (fit.ratio === 1 ? 0 : 0.04);
}

export function pickSongForCadence(cadence: number, songs: readonly Song[]): Song {
  let best = songs[0]!;
  let cost = Infinity;
  for (const s of songs) {
    const c = stretchCost(cadence, s);
    if (c < cost) {
      cost = c;
      best = s;
    }
  }
  return best;
}

export const LEAD_MAX = 0.03;

export interface Guide {
  /** 音乐此刻应该按多少「步 / 分」来放 */
  tempo: number;
  /** 是否已经到了目标附近：到了就锁到脚步上 */
  arrived: boolean;
  /** 领先比例（正 = 音乐比你快） */
  lead: number;
}

/**
 * 节拍引导：离目标还远时，音乐按「当前步频 × (1 ± 最多 3%)」放，不锁相位，你会不自觉地跟上去；
 * 差距在 2 步 / 分以内就算到达，转为锁定在你的脚步上。
 */
export function guideTempo(cadence: number, target: number | null): Guide {
  if (target === null || Math.abs(target - cadence) <= 2) return { tempo: cadence, arrived: true, lead: 0 };
  const lead = Math.max(-LEAD_MAX, Math.min(LEAD_MAX, (target - cadence) / cadence));
  return { tempo: cadence * (1 + lead), arrived: false, lead };
}

/**
 * 一步是否踩在拍子上：把歌曲的拍子网格按「一步一格」细分（两步一拍时，拍点之间再插一个点），
 * 落地时刻离最近的格点不超过 tolerance 秒就算踩上。
 */
export function onBeat(stepTime: number, songBeat: number, songPeriod: number, ratio: number, tolerance = 0.06): boolean {
  const grid = songPeriod * ratio;
  return Math.abs(gridError(stepTime, songBeat, grid)) <= tolerance;
}

/** 最近 n 步的合拍率（0–1）；步数太少返回 null */
export function onBeatRate(hits: readonly boolean[], n = 32): number | null {
  const recent = hits.slice(-n);
  if (recent.length < 8) return null;
  return recent.filter(Boolean).length / recent.length;
}
