import { renderStreet, type DemoScene } from './demo-street';
import {
  chromaFromSpectrum,
  detectTonality,
  estimatePhase,
  estimateTempo,
  resampleOnsets,
  smoothChroma,
  type Tonality,
} from './dsp';

/**
 * 环境监听：只在本机实时分析，音频不上传、不保存（除非用户主动录制片段）。
 *
 * - 麦克风 → AudioWorklet 每 512 个采样点算一次低频 / 全频能量 → 起音强度（能量的对数上升量）；
 *   每 300 ms 用最近 6 秒估计一次速度与相位；
 * - 麦克风 → AnalyserNode（16384 点 FFT）→ 12 音级色度 → 嗡鸣音或调性；
 * - 手机加速度计（可选）→ 脚步的起伏 → 步频，走路时用脚步对拍。
 */

export type BeatSource = 'mic' | 'motion';

export interface EnvBeat {
  source: BeatSource;
  bpm: number;
  /** 秒 */
  period: number;
  /** 最近一拍在 AudioContext 时间轴上的时刻 */
  beat: number;
  confidence: number;
}

export interface EnvSnapshot {
  beat: EnvBeat | null;
  /** 正在收集数据（还不到 3 秒） */
  warming: boolean;
  tonality: Tonality;
  chroma: number[];
  /** 0–1 的输入音量 */
  level: number;
  motion: boolean;
  /** 已经真的收到过加速度数据（桌面浏览器往往有接口但没有传感器） */
  motionLive: boolean;
  /** 步频（步 / 分），只来自加速度计 */
  cadence: number | null;
}

const WORKLET = `
class OnsetProc extends AudioWorkletProcessor {
  constructor() { super(); this.lp = 0; this.low = 0; this.full = 0; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      const a = 0.02;
      for (let i = 0; i < ch.length; i++) {
        const x = ch[i];
        this.lp += a * (x - this.lp);
        this.low += this.lp * this.lp;
        this.full += x * x;
      }
      this.n += ch.length;
      if (this.n >= 512) {
        this.port.postMessage({ t: currentTime, low: this.low / this.n, full: this.full / this.n });
        this.low = 0; this.full = 0; this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('musichere-onset', OnsetProc);
`;

const WINDOW_S = 6;
const MIN_S = 2.5;
const CONF_MIN = 0.28;

class Ring {
  readonly v: Float32Array;
  readonly t: Float64Array;
  n = 0;
  constructor(size: number) {
    this.v = new Float32Array(size);
    this.t = new Float64Array(size);
  }
  push(v: number, t: number) {
    const i = this.n % this.v.length;
    this.v[i] = v;
    this.t[i] = t;
    this.n++;
  }
  /** 最近 count 个值（按时间顺序） */
  last(count: number): { v: Float32Array; t: Float64Array } {
    const c = Math.min(count, this.n, this.v.length);
    const v = new Float32Array(c);
    const t = new Float64Array(c);
    for (let k = 0; k < c; k++) {
      const i = (this.n - c + k) % this.v.length;
      v[k] = this.v[i]!;
      t[k] = this.t[i]!;
    }
    return { v, t };
  }
}

export class EnvListener {
  readonly ctx: AudioContext;
  /** 分析的输入：真实麦克风，或模拟街头的混音节点 */
  source: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private demo: { mix: GainNode; monitor: GainNode; playing: AudioBufferSourceNode | null; buffers: Map<string, AudioBuffer> } | null = null;
  private node: AudioWorkletNode | null = null;
  private proc: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private fps = 93.75;
  private onsets: Ring;
  private history: number[] = [];
  private levelAcc = 0;
  private hitMean = 0;
  private hitVar = 0;
  private lastHit = 0;
  private chroma = new Array<number>(12).fill(0);
  private tonality: Tonality = { kind: 'none' };
  private candidate: { sig: string; n: number } = { sig: '', n: 0 };
  private micBeat: EnvBeat | null = null;
  private motionBeat: EnvBeat | null = null;
  private motion: Ring;
  private motionPrev = 0;
  private motionLp = 9.8;
  private motionOn = false;
  private motionSeen = false;
  private stepMean = 0;
  private stepVar = 1;
  private lastStep = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private onMotionEvent = (e: DeviceMotionEvent) => this.handleMotion(e);
  /** 每检测到一个环境重音就回调一次（用于可视化与侧链） */
  onHit: ((t: number, strength: number) => void) | null = null;
  /** 每检测到一步就回调一次（AudioContext 时间） */
  onStep: ((t: number) => void) | null = null;
  /** 拍子从哪来：auto 取置信度更高者；跑步时只认脚步 */
  beatSource: 'auto' | 'mic' | 'motion' = 'auto';
  /** 估计步频时偏好的速度：散步约 112，跑步约 165 */
  motionPref = 112;
  /** 估计步频时接受的最慢速度：走路约 70，跑步 120（避免锁到两步一拍的半速） */
  motionMin = 70;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.fps = ctx.sampleRate / 512;
    this.onsets = new Ring(Math.ceil(this.fps * 10));
    this.motion = new Ring(60 * 10);
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    await this.wire(this.ctx.createMediaStreamSource(this.stream));
  }

  /**
   * 不用麦克风：把一段合成的街头环境声当作「世界」，既喂给分析，也（小声）放出来，
   * 这样不在街上、没有麦克风权限、站点不是 HTTPS 时也能体验对拍和定调。
   */
  async startDemo(scene: DemoScene): Promise<void> {
    const mix = this.ctx.createGain();
    const monitor = this.ctx.createGain();
    monitor.gain.value = 0.5;
    mix.connect(monitor).connect(this.ctx.destination);
    this.demo = { mix, monitor, playing: null, buffers: new Map() };
    this.playDemo(scene);
    await this.wire(mix);
  }

  /** 换一个模拟场景（世界的拍子和调变了，看引擎多久重新跟上） */
  setDemoScene(scene: DemoScene) {
    if (!this.demo) return;
    this.playDemo(scene);
    // 旧场景的起音不该再参与估计：清空窗口，重新「听」
    this.onsets.n = 0;
    this.history = [];
    this.micBeat = null;
    this.hitMean = 0;
    this.hitVar = 0;
    this.candidate = { sig: '', n: 0 };
    this.chroma.fill(0);
    this.tonality = { kind: 'none' };
  }

  private playDemo(scene: DemoScene) {
    const d = this.demo;
    if (!d) return;
    let buf = d.buffers.get(scene.id);
    if (!buf) {
      const pcm = renderStreet(scene, this.ctx.sampleRate);
      buf = this.ctx.createBuffer(1, pcm.length, this.ctx.sampleRate);
      buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
      d.buffers.set(scene.id, buf);
    }
    try {
      d.playing?.stop();
    } catch {}
    d.playing?.disconnect();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(d.mix);
    src.start();
    d.playing = src;
  }

  private async wire(src: AudioNode): Promise<void> {
    this.source = src;
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    sink.connect(this.ctx.destination);
    if (this.ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.node = new AudioWorkletNode(this.ctx, 'musichere-onset');
      this.node.port.onmessage = (e: MessageEvent<{ t: number; low: number; full: number }>) => this.handleFrame(e.data);
      src.connect(this.node).connect(sink);
    } else {
      // 纯 HTTP 页面里浏览器不提供 AudioWorklet（只在安全上下文可用）：退回到 ScriptProcessor，算法相同。
      // 它已被标记为弃用，但所有浏览器仍支持，足够撑起「模拟街头」的演示。
      const proc = this.ctx.createScriptProcessor(512, 1, 1);
      let lp = 0;
      const frame = 512 / this.ctx.sampleRate;
      proc.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        let low = 0;
        let full = 0;
        for (let i = 0; i < ch.length; i++) {
          const x = ch[i]!;
          lp += 0.02 * (x - lp);
          low += lp * lp;
          full += x * x;
        }
        this.handleFrame({ t: e.playbackTime - frame, low: low / ch.length, full: full / ch.length });
      };
      src.connect(proc).connect(sink);
      this.proc = proc;
    }

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 16384;
    this.analyser.smoothingTimeConstant = 0;
    src.connect(this.analyser);

    this.timers.push(setInterval(() => this.analyzeBeat(), 300));
    this.timers.push(setInterval(() => this.analyzeTonality(), 250));
  }

  /** 走路时用脚步对拍（iOS 需要在点击事件里请求权限） */
  async startMotion(): Promise<boolean> {
    if (typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') return false;
    const D = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof D.requestPermission === 'function') {
      try {
        if ((await D.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    window.addEventListener('devicemotion', this.onMotionEvent);
    this.motionOn = true;
    return true;
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.demo) {
      try {
        this.demo.playing?.stop();
      } catch {}
      this.demo.playing?.disconnect();
      this.demo.mix.disconnect();
      this.demo.monitor.disconnect();
      this.demo = null;
    }
    this.node?.disconnect();
    if (this.proc) {
      this.proc.onaudioprocess = null;
      this.proc.disconnect();
      this.proc = null;
    }
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.motionOn) window.removeEventListener('devicemotion', this.onMotionEvent);
    this.motionOn = false;
    this.stream = null;
    this.source = null;
  }

  snapshot(): EnvSnapshot {
    const beat = this.bestBeat();
    return {
      beat,
      warming: this.onsets.n < this.fps * MIN_S,
      tonality: this.tonality,
      chroma: [...this.chroma],
      level: Math.min(1, this.levelAcc),
      motion: this.motionOn,
      motionLive: this.motionSeen,
      cadence: this.motionBeat?.bpm ?? null,
    };
  }

  private bestBeat(): EnvBeat | null {
    const m = this.beatSource === 'motion' ? null : this.micBeat;
    const s = this.beatSource === 'mic' ? null : this.motionBeat;
    if (m && s) return s.confidence > m.confidence ? s : m;
    return m ?? s;
  }

  // ---------------------------------------------------------- 麦克风：起音

  private handleFrame({ t, low, full }: { t: number; low: number; full: number }) {
    const ll = Math.log10(low + 1e-10);
    const lf = Math.log10(full + 1e-10);
    // 和前几帧的平均比，只看上升（起音），低频（脚步、鼓、车轮）权重更高
    this.history.push(ll, lf);
    if (this.history.length > 8) this.history.splice(0, 2);
    let ml = 0;
    let mf = 0;
    const k = this.history.length / 2;
    for (let i = 0; i < this.history.length; i += 2) {
      ml += this.history[i]!;
      mf += this.history[i + 1]!;
    }
    ml /= k;
    mf /= k;
    // 限幅：麦克风刚打开、或突然一声巨响时的跳变不应压过之后所有的拍子
    const onset = Math.min(1.2, Math.max(0, ll - ml) * 0.7 + Math.max(0, lf - mf) * 0.3);
    this.onsets.push(onset, t);
    this.levelAcc = this.levelAcc * 0.9 + Math.min(1, Math.sqrt(full) * 6) * 0.1;

    // 重音事件：超过自适应阈值（均值 + 2.5σ），且距上一个至少 120 ms
    const d = onset - this.hitMean;
    this.hitMean += 0.02 * d;
    this.hitVar = 0.98 * (this.hitVar + 0.02 * d * d);
    if (onset > this.hitMean + 2.5 * Math.sqrt(this.hitVar) && onset > 0.12 && t - this.lastHit > 0.12) {
      this.lastHit = t;
      this.onHit?.(t, onset);
    }
  }

  private analyzeBeat() {
    const need = Math.round(this.fps * MIN_S);
    if (this.onsets.n < need) return;
    const { v, t } = this.onsets.last(Math.round(this.fps * WINDOW_S));
    const est = estimateTempo(v, this.fps);
    if (!est || est.confidence < CONF_MIN) {
      this.micBeat = null;
      return;
    }
    const phi = estimatePhase(v, est.period);
    const beat = t[t.length - 1]! - phi / this.fps;
    this.micBeat = { source: 'mic', bpm: est.bpm, period: est.period / this.fps, beat, confidence: est.confidence };
  }

  // ---------------------------------------------------------- 麦克风：调性

  private analyzeTonality() {
    if (!this.analyser) return;
    const db = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(db);
    const c = chromaFromSpectrum(db, this.ctx.sampleRate, this.analyser.fftSize);
    if (c.every((x) => x === 0)) return;
    smoothChroma(this.chroma, c, 0.15);
    const next = detectTonality(this.chroma);
    // 连续 3 次（约 0.75 秒）判断一致才采信，避免一辆车开过就跑调
    const sig = next.kind === 'drone' ? `d${next.pc}` : next.kind === 'key' ? `k${next.key.tonic}${next.key.mode}` : 'none';
    this.candidate = sig === this.candidate.sig ? { sig, n: this.candidate.n + 1 } : { sig, n: 1 };
    if (this.candidate.n >= 3) this.tonality = next;
  }

  // ---------------------------------------------------------- 加速度计：脚步

  private handleMotion(e: DeviceMotionEvent) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    this.processMotion(Math.hypot(a.x, a.y, a.z));
  }

  /**
   * 模拟跑者：把合成的加速度幅值（含重力，约 9.8 + 落地冲击）送进和真实传感器同一条管线，
   * 步数检测、步频估计、锁相全部照常工作。
   */
  enableSim() {
    this.motionOn = true;
  }

  injectMotion(mag: number) {
    this.processMotion(mag);
  }

  private processMotion(mag: number) {
    this.motionSeen = true;
    const now = this.ctx.currentTime;
    this.motionLp += 0.05 * (mag - this.motionLp);
    const v = mag - this.motionLp;
    const onset = Math.max(0, v - this.motionPrev);
    this.motionPrev = v;
    this.motion.push(onset, now);
    if (this.motion.n % 15 === 0) this.analyzeMotion();

    // 单步检测：落地冲击超过自适应阈值（均值 + 1.5σ，且 > 0.8 m/s²），两步之间至少 250 ms
    const d = v - this.stepMean;
    this.stepMean += 0.01 * d;
    this.stepVar = 0.99 * (this.stepVar + 0.01 * d * d);
    if (v > this.stepMean + 1.5 * Math.sqrt(this.stepVar) && v > 0.8 && now - this.lastStep > 0.25) {
      this.lastStep = now;
      this.onStep?.(now);
    }
  }

  private analyzeMotion() {
    const all = this.motion.last(600);
    if (all.v.length < 100) return;
    const tEnd = all.t[all.t.length - 1]!;
    const from = all.t.findIndex((x) => x >= tEnd - WINDOW_S);
    const t = all.t.subarray(from);
    const span = tEnd - t[0]!;
    if (span < 2.5) return;
    // 传感器的采样间隔并不均匀：先按时间戳放进 60 Hz 的均匀网格，再估计
    const fps = 60;
    const grid = resampleOnsets(t, all.v.subarray(from), fps);
    const est = estimateTempo(grid, fps, { minBpm: this.motionMin, maxBpm: 200, prefBpm: this.motionPref });
    if (!est || est.confidence < 0.35) {
      this.motionBeat = null;
      return;
    }
    const phi = estimatePhase(grid, est.period);
    this.motionBeat = { source: 'motion', bpm: est.bpm, period: est.period / fps, beat: tEnd - phi / fps, confidence: est.confidence };
  }
}
