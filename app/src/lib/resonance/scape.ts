import type { Key } from './dsp';
import type { SpaceId } from './engine';

/**
 * 声景模式：不是播放一首歌，而是由「此刻的输入」实时生成一段永不重复的声景。
 * 输入：时间（昼夜节律）、天气（雨、风、气温）、你的步子、环境里的嗡鸣与这里的共鸣指纹。
 * 这里是纯函数的部分——把输入翻译成调、速度、明暗、空间和各层的强度。
 */

export type ScapeMode = 'focus' | 'relax' | 'walk' | 'sleep';

export const SCAPE_MODES: Record<ScapeMode, { label: string; hint: string }> = {
  focus: { label: '专注', hint: '稳定的低速脉冲 + 稀疏的钟琴，帮你进入心流' },
  relax: { label: '放松', hint: '跟着声音呼吸：吸气 4 秒，呼气 6 秒' },
  walk: { label: '散步', hint: '脉冲跟着你的脚步走，城市的嗡鸣就是根音' },
  sleep: { label: '入睡', hint: '越来越慢、越来越暗，没有任何节拍' },
};

export interface Weather {
  /** 0–1 */
  rain: number;
  /** 0–1 */
  wind: number;
  /** 摄氏度 */
  temp: number;
  label: string;
  isDay: boolean;
}

/** Open-Meteo 的 WMO 天气代码 → 中文 */
function weatherLabel(code: number): string {
  if (code === 0) return '晴';
  if (code <= 3) return '多云';
  if (code === 45 || code === 48) return '雾';
  if (code >= 51 && code <= 57) return '毛毛雨';
  if (code >= 61 && code <= 67) return '雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return '阵雨';
  if (code >= 85 && code <= 86) return '阵雪';
  if (code >= 95) return '雷雨';
  return '—';
}

/** 解析 Open-Meteo `current` 字段；格式不对返回 null */
export function parseWeather(json: unknown): Weather | null {
  const c = (json as { current?: Record<string, unknown> } | null)?.current;
  if (!c) return null;
  const num = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : null);
  const code = num('weather_code');
  const temp = num('temperature_2m');
  if (code === null || temp === null) return null;
  const precip = num('precipitation') ?? 0;
  const wet = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  const rain = Math.max(wet ? 0.35 : 0, Math.min(1, precip / 2.5));
  const wind = Math.min(1, (num('wind_speed_10m') ?? 0) / 40);
  return { rain, wind, temp, label: weatherLabel(code), isDay: num('is_day') !== 0 };
}

export interface ScapePlan {
  key: Key;
  /** 无步子可跟时的速度（BPM） */
  bpm: number;
  brightness: number;
  density: number;
  space: SpaceId;
  pad: 'warm' | 'saw' | 'glass';
  /** 每个十六分音符出现钟琴音的概率 */
  bell: number;
  /** 0–1：脉冲（轻柔的低音鼓 + 沙锤）的强度；0 = 没有节拍 */
  pulse: number;
  rain: number;
  wind: number;
  /** 呼吸引导的周期（秒），null = 不做 */
  breath: number | null;
  /** 给界面看的一句话 */
  why: string[];
}

/**
 * 昼夜节律：清晨明亮的大调、午后中性、黄昏温暖、深夜暗的小调；
 * 下雨更暗更潮湿，冷天用玻璃质感的铺底，暖天用温暖的铺底。
 */
export function planScape(mode: ScapeMode, hour: number, weather: Weather | null): ScapePlan {
  const why: string[] = [];
  const night = hour >= 21 || hour < 5 || (weather ? !weather.isDay : false);
  let tonic = 2; // D
  let modeKey: Key['mode'] = 'major';
  let brightness = 0.7;
  if (hour >= 5 && hour < 10) {
    tonic = 2;
    brightness = 0.82;
    why.push('清晨 → 明亮的大调');
  } else if (hour >= 10 && hour < 17) {
    tonic = 0;
    brightness = 0.72;
    why.push('白天 → 中性的大调');
  } else if (hour >= 17 && hour < 21) {
    tonic = 5;
    brightness = 0.58;
    why.push('黄昏 → 温暖、略暗');
  } else {
    tonic = 9;
    modeKey = 'minor';
    brightness = 0.4;
    why.push('深夜 → 暗的小调');
  }
  if (night && modeKey === 'major' && hour >= 17) {
    brightness -= 0.08;
  }

  const rain = weather?.rain ?? 0;
  const wind = weather?.wind ?? 0;
  if (rain > 0.2) {
    brightness -= 0.12;
    if (modeKey === 'major' && rain > 0.5) modeKey = 'minor';
    why.push(`${weather!.label} → 加入雨声层，整体更暗`);
  }
  if (wind > 0.3) why.push('有风 → 加入风声层');
  const pad = weather ? (weather.temp >= 24 ? 'warm' : weather.temp <= 8 ? 'glass' : 'warm') : 'warm';
  if (weather) why.push(`${Math.round(weather.temp)}°C → ${pad === 'glass' ? '冷冽的玻璃音色' : '温暖的铺底'}`);

  const base: Record<ScapeMode, Omit<ScapePlan, 'key' | 'brightness' | 'pad' | 'rain' | 'wind' | 'why'>> = {
    focus: { bpm: 64, density: 0.45, space: 'room', bell: 0.05, pulse: 0.35, breath: null },
    relax: { bpm: 56, density: 0.35, space: 'open', bell: 0.04, pulse: 0, breath: 10 },
    walk: { bpm: 108, density: 0.55, space: 'open', bell: 0.07, pulse: 0.6, breath: null },
    sleep: { bpm: 46, density: 0.2, space: 'hall', bell: 0.02, pulse: 0, breath: 12 },
  };
  const b = base[mode];
  return {
    ...b,
    key: { tonic, mode: modeKey },
    brightness: Math.max(0.15, Math.min(0.95, mode === 'sleep' ? brightness - 0.2 : brightness)),
    pad: mode === 'sleep' ? 'glass' : pad,
    rain,
    wind,
    why,
  };
}

/** 声景里的和弦游走：在顺阶和弦之间随机走，偏好回到主和弦 */
export function nextChord(current: number, minor: boolean, rnd: () => number): number {
  const moves: Record<number, number[]> = minor
    ? { 1: [6, 4, 7, 3], 3: [6, 4, 1], 4: [1, 7, 6], 6: [7, 4, 1, 3], 7: [1, 3, 6] }
    : { 1: [4, 6, 5, 2], 2: [5, 4, 1], 4: [1, 5, 2, 6], 5: [1, 6, 4], 6: [4, 2, 5, 1] };
  const opts = moves[current] ?? [1];
  return opts[Math.floor(rnd() * opts.length)]!;
}

/** 五声音阶的级数（声景里的钟琴只用这些音，永远不会「错」） */
export const PENTA: Record<Key['mode'], number[]> = { major: [1, 2, 3, 5, 6], minor: [1, 3, 4, 5, 7] };

/** 时段名（与服务端 ai/time.ts 一致） */
export function hourLabel(hour: number): string {
  if (hour >= 5 && hour < 8) return '清晨';
  if (hour >= 8 && hour < 11) return '上午';
  if (hour >= 11 && hour < 13) return '正午';
  if (hour >= 13 && hour < 17) return '午后';
  if (hour >= 17 && hour < 19) return '黄昏';
  if (hour >= 19 && hour < 23) return '夜晚';
  return '深夜';
}

/** 从 Open-Meteo 取当前天气（免密钥）；超时或失败返回 null，声景退回只用时间与环境 */
export async function fetchWeather(lat: number, lng: number, timeoutMs = 5000): Promise<Weather | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
      '&current=temperature_2m,precipitation,weather_code,wind_speed_10m,is_day&timezone=auto';
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    return parseWeather(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
