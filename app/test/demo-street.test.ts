/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEMO_SCENES, renderStreet } from '../src/lib/resonance/demo-street';
import { estimateTempo } from '../src/lib/resonance/dsp';

const RATE = 48000;
const FPS = RATE / 512;

/** 和监听器里的 AudioWorklet + handleFrame 同一套算法：每 512 点一帧低频 / 全频能量 → 起音强度 */
function onsets(pcm: Float32Array, repeat: number) {
  const n = pcm.length * repeat;
  let lp = 0;
  const out: number[] = [];
  const hist: number[] = [];
  for (let f = 0; f + 512 <= n; f += 512) {
    let low = 0;
    let full = 0;
    for (let i = f; i < f + 512; i++) {
      const x = pcm[i % pcm.length]!;
      lp += 0.02 * (x - lp);
      low += lp * lp;
      full += x * x;
    }
    hist.push(Math.log10(low / 512 + 1e-10), Math.log10(full / 512 + 1e-10));
    if (hist.length > 8) hist.splice(0, 2);
    let ml = 0;
    let mf = 0;
    const k = hist.length / 2;
    for (let i = 0; i < hist.length; i += 2) {
      ml += hist[i]!;
      mf += hist[i + 1]!;
    }
    out.push(Math.min(1.2, Math.max(0, hist[hist.length - 2]! - ml / k) * 0.7 + Math.max(0, hist[hist.length - 1]! - mf / k) * 0.3));
  }
  return out;
}

describe('模拟街头', () => {
  for (const s of DEMO_SCENES) {
    const pcm = renderStreet(s, RATE);

    it(`${s.label}：长度是整数拍，峰值不削波`, () => {
      const beats = (pcm.length / RATE) * (s.bpm / 60);
      assert.ok(Math.abs(beats - Math.round(beats)) < 0.01, `${beats} 拍`);
      let peak = 0;
      for (const v of pcm) peak = Math.max(peak, Math.abs(v));
      assert.ok(peak <= 0.86 && peak > 0.5, `峰值 ${peak}`);
    });

    it(`${s.label}：首尾衔接，循环处没有跳变`, () => {
      let maxStep = 0;
      for (let i = 1; i < 2000; i++) maxStep = Math.max(maxStep, Math.abs(pcm[i]! - pcm[i - 1]!));
      const seam = Math.abs(pcm[0]! - pcm[pcm.length - 1]!);
      assert.ok(seam <= Math.max(maxStep * 2, 0.05), `接缝 ${seam}，片段内最大相邻差 ${maxStep}`);
    });

    it(`${s.label}：引擎自己的拍子估计能认出 ${s.bpm} BPM`, () => {
      const v = onsets(pcm, 3);
      const est = estimateTempo(v.slice(-Math.round(FPS * 6)), FPS);
      assert.ok(est, '应有结果');
      assert.ok(Math.abs(est!.bpm - s.bpm) < 3, `估计 ${est!.bpm.toFixed(1)}，实际 ${s.bpm}`);
      assert.ok(est!.confidence > 0.3, `置信度 ${est!.confidence}`);
    });
  }

  it('确定性：同一场景渲染两次完全一样', () => {
    const a = renderStreet(DEMO_SCENES[0]!, RATE);
    const b = renderStreet(DEMO_SCENES[0]!, RATE);
    assert.deepEqual(a, b);
  });
});
