/**
 * 模拟街头：在没有麦克风（纯 HTTP 站点、权限被拒、评委不在街上）时，用一段合成的环境声代替麦克风，
 * 让「对拍 → 定调」照样能被现场看见、听见。
 *
 * 它和 `e2e/street-sound.cjs` 里喂给假麦克风的声音是同一类：低频的脚步 / 手鼓 + 持续的嗡鸣 + 底噪。
 * 区别是这里的片段**首尾无缝**，可以一直循环：
 *   - 长度正好是整数拍，所以循环处节拍不错位；
 *   - 嗡鸣频率微调到在片段里走整数个周期（≤ 0.04 Hz，不改变音级），所以循环处不爆音；
 *   - 底噪用「绕圈」滤波生成，首尾连续。
 */

export interface DemoScene {
  id: 'walk' | 'busker';
  label: string;
  /** 一句话：这个场景里「世界」是什么声音 */
  hint: string;
  bpm: number;
  /** 嗡鸣的基频（Hz） */
  droneHz: number;
  /** 脚步 / 鼓点「咚」的起始音高（Hz） */
  thudHz: number;
}

export const DEMO_SCENES: readonly DemoScene[] = [
  { id: 'walk', label: '江边散步', hint: '112 BPM 的脚步 + 110 Hz（A）的轮船嗡鸣', bpm: 112, droneHz: 110, thudHz: 75 },
  { id: 'busker', label: '街头艺人', hint: '96 BPM 的手鼓 + 98 Hz（G）的低音嗡鸣', bpm: 96, droneHz: 98, thudHz: 110 },
];

/** 一个循环片段的拍数 */
const LOOP_BEATS = 32;

/** 确定性伪随机，返回 [-1, 1) */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1;
}

/** 渲染一个无缝循环的片段（单声道，峰值 0.85） */
export function renderStreet(scene: DemoScene, rate = 48000): Float32Array {
  const period = 60 / scene.bpm;
  const seconds = LOOP_BEATS * period;
  const n = Math.round(seconds * rate);
  const x = new Float32Array(n);
  const rnd = rng(scene.bpm * 31 + Math.round(scene.droneHz));

  // 嗡鸣：频率微调到片段内整数个周期
  const hz = Math.round(scene.droneHz * seconds) / seconds;
  const amHz = Math.max(1, Math.round(0.21 * seconds)) / seconds;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const am = 1 + 0.2 * Math.sin(2 * Math.PI * amHz * t);
    const hum =
      0.13 * Math.sin(2 * Math.PI * hz * t) +
      0.07 * Math.sin(2 * Math.PI * hz * 2 * t + 0.4) +
      0.04 * Math.sin(2 * Math.PI * hz * 3 * t + 1.1) +
      0.02 * Math.sin(2 * Math.PI * hz * 4 * t + 2.0);
    x[i] = hum * am;
  }

  // 底噪：棕噪声，沿圆环滤波两圈取第二圈，首尾连续
  const white = new Float32Array(n);
  for (let i = 0; i < n; i++) white[i] = rnd() * 0.02;
  let brown = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      brown = brown * 0.985 + white[i]!;
      if (pass === 1) x[i] = x[i]! + brown * 0.6 + rnd() * 0.006;
    }
  }

  // 脚步 / 鼓点：左右轻重不同，带 ±8 ms 抖动，尾巴绕回片段开头
  const tail = Math.round(0.12 * rate);
  for (let k = 0; k < LOOP_BEATS; k++) {
    const start = Math.round((0.25 + k * period + rnd() * 0.008) * rate);
    const amp = k % 2 ? 0.7 : 1;
    for (let j = 0; j < tail; j++) {
      const t = j / rate;
      const thud = Math.sin(2 * Math.PI * (scene.thudHz - 120 * t) * t) * Math.exp(-t / 0.045) * 0.75;
      const scuff = rnd() * Math.exp(-t / 0.012) * 0.22;
      const i = (start + j) % n;
      x[i] = x[i]! + amp * (thud + scuff);
    }
  }

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]!));
  const g = peak > 0 ? 0.85 / peak : 1;
  for (let i = 0; i < n; i++) x[i] = x[i]! * g;
  return x;
}
