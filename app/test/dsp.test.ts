/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chooseTranspose,
  chromaFromSpectrum,
  detectTonality,
  estimateKey,
  estimatePhase,
  estimateTempo,
  fitTempo,
  gridError,
  keyName,
  wrapSemis,
} from '../src/lib/resonance/dsp';

const FPS = 48000 / 512; // 93.75 帧 / 秒，和监听器一致

/** 确定性伪随机 */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

/** 生成一段起音强度序列：每拍一个脉冲（可带抖动、强弱交替）+ 噪声 */
function onsetTrain(bpm: number, seconds: number, opts: { jitterMs?: number; noise?: number; offsetS?: number; seed?: number } = {}) {
  const { jitterMs = 0, noise = 0.1, offsetS = 0.13, seed = 1 } = opts;
  const r = rng(seed);
  const n = Math.round(seconds * FPS);
  const x = new Array<number>(n).fill(0).map(() => r() * noise);
  const period = 60 / bpm;
  let k = 0;
  for (let t = offsetS; t < seconds; t += period, k++) {
    const tt = t + ((r() - 0.5) * 2 * jitterMs) / 1000;
    const i = Math.round(tt * FPS);
    if (i >= 0 && i < n) x[i] = x[i]! + (k % 2 ? 0.7 : 1); // 左右脚轻重不同
  }
  return x;
}

describe('节奏', () => {
  for (const bpm of [72, 96, 112, 128, 150]) {
    it(`识别 ${bpm} BPM（带抖动与噪声）`, () => {
      const est = estimateTempo(onsetTrain(bpm, 6, { jitterMs: 12, noise: 0.25, seed: bpm }), FPS);
      assert.ok(est, '应有结果');
      if (!est) return;
      assert.ok(Math.abs(est.bpm - bpm) < 2.5, `估计 ${est.bpm.toFixed(1)}，实际 ${bpm}`);
      assert.ok(est.confidence > 0.3, `置信度 ${est.confidence}`);
    });
  }

  it('纯噪声没有可信的拍子', () => {
    const r = rng(9);
    const est = estimateTempo(new Array(560).fill(0).map(() => r()), FPS);
    assert.ok(!est || est.confidence < 0.25, `置信度 ${est?.confidence}`);
  });

  it('全零输入返回 null', () => {
    assert.equal(estimateTempo(new Array(560).fill(0), FPS), null);
  });

  it('相位：找到最近一拍离末尾多远', () => {
    const bpm = 112;
    const seconds = 6;
    const x = onsetTrain(bpm, seconds, { offsetS: 0.21, noise: 0.15 });
    const period = (FPS * 60) / bpm;
    const phi = estimatePhase(x, period);
    // 真实的最后一拍
    const p = 60 / bpm;
    const lastBeat = 0.21 + Math.floor((seconds - 1 / FPS - 0.21) / p) * p;
    const expected = (x.length - 1) - Math.round(lastBeat * FPS);
    assert.ok(Math.abs(phi - expected) <= 1, `phi ${phi} vs ${expected}`);
  });

  it('倍速选择：慢拍的脚步配快歌取 2 倍', () => {
    assert.deepEqual(fitTempo(56, 112), { bpm: 112, ratio: 2 });
    assert.deepEqual(fitTempo(118, 100), { bpm: 118, ratio: 1 });
    assert.equal(fitTempo(170, 84).ratio, 0.5);
  });

  it('网格误差落在半个周期内', () => {
    assert.ok(Math.abs(gridError(10.02, 1, 0.5) - -0.02) < 1e-9);
    assert.ok(Math.abs(gridError(10.24, 1, 0.5) - 0.26) > 0.2); // 10.24 离 10.0 更近：-0.24
    assert.ok(Math.abs(gridError(10.24, 1, 0.5) - -0.24) < 1e-9);
  });
});

/** 合成一张 AnalyserNode 风格的分贝频谱：若干正弦峰 + 噪声底 */
function spectrum(peaks: { f: number; db: number }[], sampleRate = 48000, fftSize = 16384, floor = -95) {
  const binHz = sampleRate / fftSize;
  const r = rng(3);
  const db = new Array<number>(fftSize / 2).fill(0).map(() => floor + r() * 6);
  for (const { f, db: level } of peaks) {
    const k = f / binHz;
    for (let i = Math.floor(k) - 3; i <= Math.ceil(k) + 3; i++) {
      if (i < 0 || i >= db.length) continue;
      const v = level - 6 * (i - k) ** 2; // 主瓣
      db[i] = Math.max(db[i]!, v);
    }
  }
  return db;
}

describe('调性', () => {
  it('发动机嗡鸣（110 Hz 及谐波）→ A 是主导音', () => {
    const chroma = chromaFromSpectrum(spectrum([{ f: 110, db: -20 }, { f: 220, db: -28 }, { f: 330, db: -34 }, { f: 440, db: -38 }]), 48000, 16384);
    const t = detectTonality(chroma);
    assert.equal(t.kind, 'drone');
    assert.equal(t.kind === 'drone' && t.pc, 9);
  });

  it('C 大调音阶与和弦 → C 大调', () => {
    const notes = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 130.81, 196.0, 164.81];
    const weights = [-20, -30, -24, -30, -22, -30, -32, -22, -26, -28];
    const chroma = chromaFromSpectrum(spectrum(notes.map((f, i) => ({ f, db: weights[i]! }))), 48000, 16384);
    const est = estimateKey(chroma);
    assert.equal(keyName(est.key), 'C 大调');
    const t = detectTonality(chroma);
    assert.equal(t.kind, 'key');
  });

  it('A 小调的音（A C E 为主）→ A 小调', () => {
    const chroma = [0.04, 0.0, 0.05, 0.0, 0.18, 0.04, 0.0, 0.05, 0.02, 0.3, 0.0, 0.04].map((v, i) => (i === 0 ? 0.2 : v));
    assert.equal(keyName(estimateKey(chroma).key), 'A 小调');
  });

  it('安静 / 只有噪声 → 没有调', () => {
    assert.equal(detectTonality(new Array(12).fill(0)).kind, 'none');
    assert.equal(detectTonality(new Array(12).fill(1 / 12)).kind, 'none');
  });
});

describe('移调决策', () => {
  const C_MAJOR = { tonic: 0, mode: 'major' as const };

  it('嗡鸣 A：作属音只需 +2（D 大调），比作主音的 -3 更近', () => {
    assert.deepEqual(chooseTranspose(C_MAJOR, { kind: 'drone', pc: 9, strength: 0.6 }), { semis: 2, mode: 'major', role: '属音' });
  });

  it('嗡鸣 D：作主音 +2', () => {
    assert.deepEqual(chooseTranspose(C_MAJOR, { kind: 'drone', pc: 2, strength: 0.6 }), { semis: 2, mode: 'major', role: '主音' });
  });

  it('街头艺人在弹 E 小调：歌曲移到 E 并转小调', () => {
    assert.deepEqual(chooseTranspose(C_MAJOR, { kind: 'key', key: { tonic: 4, mode: 'minor' }, strength: 0.8 }), {
      semis: 4,
      mode: 'minor',
      role: '同调',
    });
  });

  it('没有调就不动', () => {
    assert.equal(chooseTranspose(C_MAJOR, { kind: 'none' }), null);
  });

  it('移调总是走最近的方向', () => {
    assert.equal(wrapSemis(11), -1);
    assert.equal(wrapSemis(-7), 5);
    assert.equal(wrapSemis(6), -6);
  });
});
