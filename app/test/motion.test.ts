/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimatePhase, estimateTempo, resampleOnsets } from '../src/lib/resonance/dsp';

/** 带抖动采样的脚步：每步一个 0.09 s 的半正弦冲击，采样间隔在 0.3–2.0 倍之间随机，起音 = 增量的正部 */
function steps(bpm: number, seconds: number, nominalFps: number, seed: number) {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const t: number[] = [];
  for (let x = 0; x < seconds; x += (1 / nominalFps) * (0.3 + 1.7 * rnd())) t.push(x);
  const per = 60 / bpm;
  const v = t.map((x) => {
    const ph = (((x - 0.4) % per) + per) % per;
    return ph < 0.09 ? 7 * Math.sin((Math.PI * ph) / 0.09) : 0;
  });
  return { t, on: v.map((x, i) => Math.max(0, x - (v[i - 1] ?? 0))) };
}

describe('加速度起音：按时间戳重采样', () => {
  it('采样间隔不均时，重采样后各步频都能估准', () => {
    for (const bpm of [135, 150, 160, 167, 172, 185]) {
      for (const fps of [30, 42, 60]) {
        const { t, on } = steps(bpm, 6, fps, bpm * 7 + fps);
        const grid = resampleOnsets(t, on, 60);
        const est = estimateTempo(grid, 60, { minBpm: 120, maxBpm: 200, prefBpm: 165 });
        assert.ok(est, `${bpm}@${fps} 应有结果`);
        assert.ok(Math.abs(est!.bpm - bpm) < 3.5, `真实 ${bpm}@${fps}Hz，估计 ${est!.bpm.toFixed(1)}`);
      }
    }
  });

  it('相位：最近一步离窗口末尾的位置对得上', () => {
    const bpm = 160;
    const { t, on } = steps(bpm, 6, 42, 5);
    const grid = resampleOnsets(t, on, 60);
    const est = estimateTempo(grid, 60, { minBpm: 120, maxBpm: 200, prefBpm: 165 })!;
    const phi = estimatePhase(grid, est.period);
    const tEnd = t[t.length - 1]!;
    const beat = tEnd - phi / 60;
    const per = 60 / bpm;
    // 落在真实步点上（脚步起点是 0.4 + k·per，冲击峰在起点之后 ~0.045 s）
    const k = Math.round((beat - 0.4) / per);
    const err = Math.abs(beat - (0.4 + k * per));
    assert.ok(err < 0.07, `相位误差 ${(err * 1000).toFixed(0)} ms`);
  });

  it('样本太少返回空网格', () => {
    assert.equal(resampleOnsets([0], [1], 60).length, 0);
  });
});
