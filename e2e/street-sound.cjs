/**
 * 生成一段模拟的街头环境声（WAV），给 Chromium 当作假麦克风输入，用来端到端验证「共鸣」：
 *   - 112 BPM 的脚步（低频的「咚」+ 鞋底摩擦的短噪声，左右脚轻重不同，带 ±8 ms 抖动）；
 *   - 江上轮船发动机的嗡鸣：110 Hz（A）及其谐波，缓慢起伏；
 *   - 街道底噪。
 *
 *   node e2e/street-sound.cjs out.wav [bpm] [droneHz] [seconds]
 */
const fs = require('node:fs');

function streetWav(file, { bpm = 112, droneHz = 110, seconds = 24, rate = 48000 } = {}) {
  const n = Math.round(seconds * rate);
  const x = new Float32Array(n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1;

  // 嗡鸣 + 底噪（棕噪声）
  let brown = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const am = 1 + 0.2 * Math.sin(2 * Math.PI * 0.21 * t);
    const hum =
      0.13 * Math.sin(2 * Math.PI * droneHz * t) +
      0.07 * Math.sin(2 * Math.PI * droneHz * 2 * t + 0.4) +
      0.04 * Math.sin(2 * Math.PI * droneHz * 3 * t + 1.1) +
      0.02 * Math.sin(2 * Math.PI * droneHz * 4 * t + 2.0);
    brown = brown * 0.985 + rnd() * 0.02;
    x[i] = hum * am + brown * 0.6 + rnd() * 0.006;
  }

  // 脚步
  const period = 60 / bpm;
  let k = 0;
  for (let t0 = 0.25; t0 < seconds - 0.2; t0 += period, k++) {
    const start = Math.round((t0 + rnd() * 0.008) * rate);
    const amp = k % 2 ? 0.7 : 1;
    for (let j = 0; j < 0.12 * rate && start + j < n; j++) {
      const t = j / rate;
      const thud = Math.sin(2 * Math.PI * (75 - 120 * t) * t) * Math.exp(-t / 0.045) * 0.75;
      const scuff = rnd() * Math.exp(-t / 0.012) * 0.22;
      x[start + j] += amp * (thud + scuff);
    }
  }

  // 16-bit PCM WAV
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
  const gain = 0.85 / peak;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * gain * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
  return file;
}

module.exports = { streetWav };

if (require.main === module) {
  const [file = 'street.wav', bpm, hz, secs] = process.argv.slice(2);
  streetWav(file, { bpm: Number(bpm) || 112, droneHz: Number(hz) || 110, seconds: Number(secs) || 24 });
  console.log('已生成', file);
}
