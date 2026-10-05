/**
 * 兔子电台的纯逻辑（不碰 Web Audio，可单测）：
 *
 *   热身（跟随）→ 带跑（掉速了才领先 3%）→ 冷却（节拍渐慢、淡出）→ 成绩单
 *
 * 设计取舍：兔子不唠叨。步频在目标附近时，音乐只是锁在你的脚步上陪你；
 * 只有步频掉到目标以下一截、并且持续了一会儿（说明是真的累了，不是抬了一下脚），
 * 音乐才先快一点点（最多 3%）把你带回去，回来了再锁回脚步。
 */
import { fitTempo } from './dsp';
import { LEAD_MAX } from './run';

export type Phase = 'warmup' | 'pace' | 'cooldown' | 'done';

export interface RabbitPlan {
  /** 目标步频（步 / 分） */
  target: number;
  /** 热身秒数 */
  warmup: number;
  /** 冷却秒数 */
  cooldown: number;
}

/** 掉到目标以下多少算「掉速」 */
export const DROP_DELTA = 4;
/** 掉速要持续多久才确认（秒） */
export const DROP_HOLD = 2;
/** 回到目标以下多少以内算「被带回来了」 */
export const BACK_DELTA = 1.5;
/** 回来后要稳住多久才确认（秒） */
export const BACK_HOLD = 2;
/** 冷却结束时音乐的速度（步 / 分） */
export const COOL_END = 120;

export function phaseAt(elapsed: number, plan: RabbitPlan, finishAt: number | null): Phase {
  if (finishAt !== null && elapsed >= finishAt + plan.cooldown) return 'done';
  if (finishAt !== null && elapsed >= finishAt) return 'cooldown';
  if (elapsed < plan.warmup) return 'warmup';
  return 'pace';
}

/** 冷却时音乐该放多快：从冷却开始时的步频线性降到 COOL_END */
export function coolTempo(startCadence: number, progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return startCadence + (COOL_END - startCadence) * p;
}

export interface DropEvent {
  /** 开始掉速的时刻（秒，确认前就已经在掉，取第一次低于阈值的时刻） */
  at: number;
  /** 当时的步频 */
  cadence: number;
  /** 回到目标附近用了多久（秒）；还没回来是 null */
  recoveredIn: number | null;
}

/** 掉速 / 回来的状态机，带迟滞，避免在阈值上来回抖 */
export class DropTracker {
  state: 'steady' | 'dropped' = 'steady';
  readonly events: DropEvent[] = [];
  /** 先「上线」：步频第一次到过目标附近之后才开始判掉速（爬坡阶段不算） */
  armed = false;
  private below: number | null = null;
  private back: number | null = null;

  constructor(private readonly target: number) {}

  update(t: number, cadence: number | null, phase: Phase) {
    if (phase !== 'pace' || cadence === null) {
      this.below = null;
      this.back = null;
      return;
    }
    if (!this.armed) {
      if (cadence >= this.target - BACK_DELTA) this.armed = true;
      return;
    }
    if (this.state === 'steady') {
      if (cadence <= this.target - DROP_DELTA) {
        this.below ??= t;
        if (t - this.below >= DROP_HOLD) {
          this.state = 'dropped';
          this.events.push({ at: this.below, cadence, recoveredIn: null });
          this.below = null;
        }
      } else this.below = null;
    } else {
      if (cadence >= this.target - BACK_DELTA) {
        this.back ??= t;
        if (t - this.back >= BACK_HOLD) {
          const e = this.events[this.events.length - 1]!;
          e.recoveredIn = this.back - e.at;
          this.state = 'steady';
          this.back = null;
        }
      } else this.back = null;
    }
  }

  get drops() {
    return this.events.length;
  }

  get recoveries() {
    return this.events.filter((e) => e.recoveredIn !== null).length;
  }

  get avgRecovery(): number | null {
    const r = this.events.map((e) => e.recoveredIn).filter((x): x is number => x !== null);
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
  }
}

export interface Control {
  /** 音乐此刻的速度（步 / 分）；锁定时等于步频 */
  music: number;
  /** 是否锁在脚步上（false = 自由速度，领先或冷却） */
  lock: boolean;
  /** 领先比例（正 = 比你快，负 = 比你慢） */
  lead: number;
  /** 给 UI 的一句话 */
  label: string;
}

export function control(
  phase: Phase,
  cadence: number,
  plan: RabbitPlan,
  tracker: DropTracker,
  cool: { startCadence: number; progress: number } | null,
): Control {
  if (phase === 'cooldown' && cool) {
    const music = coolTempo(cool.startCadence, cool.progress);
    return { music, lock: false, lead: music / cadence - 1, label: '冷却：节拍慢慢降下来，陪你把心率放回去' };
  }
  if (phase === 'pace' && tracker.state === 'dropped') {
    // 瞄准目标上方一点点（最多领先 3%），这样才能把你完全带回「被带回来」的范围内，而不是停在半路
    const music = Math.min(cadence * (1 + LEAD_MAX), plan.target + 3);
    const lead = music / cadence - 1;
    return { music, lock: false, lead, label: `兔子领先 ${Math.max(1, Math.round(lead * 100))}%，带你从 ${Math.round(cadence)} 回到 ${plan.target}` };
  }
  if (phase === 'warmup') return { music: cadence, lock: true, lead: 0, label: '热身：音乐跟着你的脚步，先不催你' };
  return { music: cadence, lock: true, lead: 0, label: tracker.state === 'dropped' ? '快回来了，锁回你的脚步' : '陪跑：每一步都踩在拍子上' };
}

/** 歌曲实际该放多快（伸缩到歌自己的速度范围） */
export function songBpmFor(music: number, songBpm: number): number {
  return fitTempo(music, songBpm).bpm;
}

// ------------------------------------------------------------------ 模拟跑者

/**
 * 模拟跑者：用来在没有手机、没有跑道的地方（评委的电脑）把一次完整的跑演一遍。
 *
 * 这是一个**模型**，不是实测：
 *   - 体力下降：在两个时间窗（模拟 16–28 s、38–48 s）里，「想要的步频」以每秒 0.8 步 / 分 往下滑；
 *   - 节奏同步：跑者会不自觉地向音乐的速度靠拢，强度 k 是我设的参数（0.4 / 秒）。
 * 所以演示能证明的是「机制是通的」（掉速被检测到 → 兔子领先 → 步频被拉回 → 锁回脚步），
 * 证明不了「真实跑者一定会被带回来」，那需要真人实测。
 */
export const SIM = {
  start: 150,
  /** 体力下降的时间窗（模拟秒） */
  fatigue: [
    [16, 28],
    [38, 48],
  ] as const,
  slope: 0.8,
  entrain: 0.4,
  /** 模拟的总节奏：热身 8 s、带跑 56 s、冷却 12 s，共 76 s */
  plan: (target: number): RabbitPlan => ({ target, warmup: 8, cooldown: 12 }),
  finishAt: 64,
};

export interface SimState {
  cadence: number;
  /** 「想要的步频」（体力决定的）；音乐把实际步频往上拉 */
  intent: number;
}

export function simInit(): SimState {
  return { cadence: SIM.start, intent: SIM.start };
}

/** 往前走 dt 秒；music 是此刻音乐的速度（步 / 分） */
export function simStep(s: SimState, t: number, dt: number, music: number, phase: Phase, plan: RabbitPlan): SimState {
  let { cadence, intent } = s;
  if (phase === 'warmup') {
    intent += dt * 0.5 * (plan.target - intent);
  } else if (phase === 'pace') {
    const tired = SIM.fatigue.some(([a, b]) => t >= a && t < b);
    if (tired) intent -= dt * SIM.slope;
    else intent = Math.min(plan.target, intent + dt * 0.9); // 缓过来一点
  } else {
    intent = music; // 冷却：跟着音乐慢下来
  }
  const k = phase === 'cooldown' ? 0.3 : SIM.entrain;
  cadence += dt * (0.2 * (intent - cadence) + k * (music - cadence));
  return { cadence, intent };
}

// ------------------------------------------------------------------ 成绩单

export interface Sample {
  t: number;
  cadence: number | null;
  music: number;
  dropped: boolean;
  phase: Phase;
}

export interface Report {
  seconds: number;
  target: number;
  avgCadence: number | null;
  /** 跟随（锁定）期间，脚步落在拍子上的比例 */
  onBeatRate: number | null;
  drops: number;
  recoveries: number;
  avgRecovery: number | null;
  events: DropEvent[];
  series: Sample[];
  simulated: boolean;
}

export function buildReport(args: {
  seconds: number;
  plan: RabbitPlan;
  series: Sample[];
  tracker: DropTracker;
  hits: readonly boolean[];
  simulated: boolean;
}): Report {
  const { seconds, plan, series, tracker, hits, simulated } = args;
  const pace = series.filter((s) => s.phase === 'pace' && s.cadence !== null);
  const avg = pace.length ? pace.reduce((a, s) => a + s.cadence!, 0) / pace.length : null;
  return {
    seconds,
    target: plan.target,
    avgCadence: avg,
    onBeatRate: hits.length >= 8 ? hits.filter(Boolean).length / hits.length : null,
    drops: tracker.drops,
    recoveries: tracker.recoveries,
    avgRecovery: tracker.avgRecovery,
    events: tracker.events,
    series,
    simulated,
  };
}
