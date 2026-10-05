import { gridError, type Key, type Mode } from './dsp';
import { nextChord, PENTA, type ScapePlan } from './scape';
import { chordSemis, degreeSemis, midiToHz, scapeSong, SONGS, type Song } from './songs';

/**
 * 共鸣引擎（Web Audio）：实时合成原创曲目，并让它
 *  - 对拍：拍点逐拍向环境的拍子网格靠拢（速度平滑滑过去，相位每拍最多修正 6%，听起来是「被带着走」而不是跳拍）；
 *  - 定调：移调与调式切换只在小节线生效，不会在一个和弦中间跑调；
 *  - 入景：编配密度、明暗（低通）、混响空间、大小调随场景变化；
 *  - 侧链：环境里每一个重音都会轻轻「推」一下音乐（-2.8 dB，150 ms 恢复）；
 *  - 录制：把环境声和音乐按真实听感对齐后录成一段片段。
 *
 * 调度沿用 Web Audio 经典的「前瞻调度」：主线程每 25 ms 醒一次，把未来 120 ms 内的音符排进音频时钟。
 */

export interface Lock {
  /** 环境拍子周期（秒） */
  period: number;
  /** 最近一拍环境拍子在 AudioContext 时间轴上的时刻 */
  beat: number;
  /** 歌曲速度 = 环境速度 × ratio */
  ratio: number;
}

export const SPACES = {
  dry: { name: '干声', seconds: 0.4, wet: 0.05 },
  room: { name: '小房间', seconds: 0.8, wet: 0.16 },
  open: { name: '开阔户外', seconds: 1.9, wet: 0.2 },
  hall: { name: '隧道 / 通道', seconds: 3.4, wet: 0.34 },
  club: { name: '现场', seconds: 1.3, wet: 0.24 },
} as const;
export type SpaceId = keyof typeof SPACES;

export interface EngineState {
  playing: boolean;
  song: Song;
  bpm: number;
  transpose: number;
  key: Key;
  locked: boolean;
  /** 最近一拍相对环境网格的偏差（毫秒） */
  phaseErrorMs: number;
  density: number;
  brightness: number;
  space: SpaceId;
  latencyMs: number;
}

const LOOKAHEAD = 0.12;
const TICK_MS = 25;

export class ResonanceEngine {
  readonly ctx: AudioContext;
  readonly recDest: MediaStreamAudioDestinationNode;
  private readonly music: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly wet: GainNode;
  private readonly verb: ConvolverNode;
  private readonly duckGain: GainNode;
  private readonly master: GainNode;
  private readonly recDelay: DelayNode;
  private readonly micRec: GainNode;
  private readonly noise: AudioBuffer;

  song: Song = SONGS[0]!;
  private pendingSong: Song | null = null;
  private period = 60 / SONGS[0]!.bpm;
  private freeBpm = SONGS[0]!.bpm;
  transpose = 0;
  private pendingTranspose: number | null = null;
  mode: Mode = SONGS[0]!.key.mode;
  private pendingMode: Mode | null = null;
  density = 0.8;
  brightness = 0.75;
  space: SpaceId = 'open';
  lock: Lock | null = null;
  phaseError = 0;
  /** 已排进时钟的拍点（用于可视化） */
  readonly beats: number[] = [];

  /** 声景模式的规划；null = 播放曲目 */
  scape: ScapePlan | null = null;
  private scapeChord = 1;
  private scapeLayers: { bus: GainNode; drone: OscillatorNode[]; stop: () => void; rain: GainNode; wind: GainNode; breath: number | null } | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private step = 0;
  private bar = 0;
  private recorder: MediaRecorder | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.music = ctx.createGain();
    this.music.gain.value = 0.9;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.5;
    const dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.verb = ctx.createConvolver();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.duckGain = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;

    this.music.connect(this.tone);
    this.tone.connect(dry).connect(comp);
    this.tone.connect(this.verb).connect(this.wet).connect(comp);
    comp.connect(this.duckGain).connect(this.master).connect(ctx.destination);

    // 录制支路：音乐按「实际听到的时刻」延后，与麦克风里的环境声对齐；两路相加后过限幅器，避免削波
    this.recDest = ctx.createMediaStreamDestination();
    const recMix = ctx.createGain();
    recMix.gain.value = 0.8;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 2;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    recMix.connect(limiter).connect(this.recDest);
    this.recDelay = ctx.createDelay(1);
    this.master.connect(this.recDelay).connect(recMix);
    this.micRec = ctx.createGain();
    this.micRec.gain.value = 0.75;
    this.micRec.connect(recMix);

    // 白噪声（鼓组用）
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.setBrightness(this.brightness);
    this.setSpace(this.space);
  }

  /** 输出 + 输入的总延迟：把它从环境拍点里减掉，耳朵里听到的音乐才会和世界同时落拍 */
  get latency(): number {
    const c = this.ctx as AudioContext & { outputLatency?: number };
    return (c.baseLatency || 0) + (c.outputLatency || 0) + 0.012;
  }

  get playing() {
    return this.timer !== null;
  }

  get key(): Key {
    return { tonic: (((this.song.key.tonic + this.transpose) % 12) + 12) % 12, mode: this.mode };
  }

  get bpm() {
    return 60 / this.period;
  }

  state(): EngineState {
    return {
      playing: this.playing,
      song: this.song,
      bpm: this.bpm,
      transpose: this.transpose,
      key: this.key,
      locked: this.lock !== null,
      phaseErrorMs: Math.round(this.phaseError * 1000),
      density: this.density,
      brightness: this.brightness,
      space: this.space,
      latencyMs: Math.round(this.latency * 1000),
    };
  }

  // ------------------------------------------------------------ 控制

  start() {
    if (this.timer) return;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    this.step = 0;
    this.bar = 0;
    this.recDelay.delayTime.value = Math.min(0.9, this.latency);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** 淡出：冷却结束时让音乐自然收尾，而不是戛然而止 */
  fadeOut(seconds: number) {
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + seconds);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.beats.length = 0;
    this.teardownScape();
  }

  /**
   * 进入 / 更新 / 退出声景。声景由引擎实时即兴：持续的根音与五度嗡鸣、在顺阶和弦间游走的铺底、
   * 五声音阶的钟琴、（可选）跟着步子的轻柔脉冲、雨声与风声层，放松 / 入睡时整体随呼吸起伏。
   */
  setScape(plan: ScapePlan | null) {
    if (!plan) {
      this.scape = null;
      this.teardownScape();
      return;
    }
    const entering = !this.scape;
    this.scape = plan;
    const song = scapeSong(plan.key, plan.bpm, plan.pad);
    if (entering || this.song.key.tonic !== plan.key.tonic || this.song.key.mode !== plan.key.mode || this.song.sound.pad !== plan.pad) {
      if (this.playing && !entering) this.pendingSong = song;
      else this.applySong(song);
    }
    this.freeBpm = plan.bpm;
    this.setDensity(plan.density);
    this.setBrightness(plan.brightness);
    this.setSpace(plan.space);
    // 呼吸周期变了（换了模式）就重建各层
    if (this.scapeLayers && this.scapeLayers.breath !== plan.breath) this.teardownScape();
    if (!this.scapeLayers) this.buildScapeLayers();
    const L = this.scapeLayers!;
    const now = this.ctx.currentTime;
    L.rain.gain.setTargetAtTime(plan.rain * 0.09, now, 1.5);
    L.wind.gain.setTargetAtTime(plan.wind * 0.07, now, 1.5);
    this.retuneDrone();
  }

  private buildScapeLayers() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(this.music);
    const nodes: AudioScheduledSourceNode[] = [];

    // 呼吸：放松 / 入睡时，整个声景随一个很慢的正弦起伏
    const breathGain = ctx.createGain();
    breathGain.gain.value = 1;
    breathGain.connect(bus);
    if (this.scape?.breath) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 1 / this.scape.breath;
      const depth = ctx.createGain();
      depth.gain.value = 0.28;
      lfo.connect(depth).connect(breathGain.gain);
      lfo.start(now);
      nodes.push(lfo);
    }

    // 嗡鸣：根音 + 五度，低通缓慢开合
    const droneLp = ctx.createBiquadFilter();
    droneLp.type = 'lowpass';
    droneLp.frequency.value = 500;
    const droneLfo = ctx.createOscillator();
    droneLfo.frequency.value = 0.05;
    const droneDepth = ctx.createGain();
    droneDepth.gain.value = 220;
    droneLfo.connect(droneDepth).connect(droneLp.frequency);
    droneLfo.start(now);
    nodes.push(droneLfo);
    const droneGain = ctx.createGain();
    droneGain.gain.setValueAtTime(0.0001, now);
    droneGain.gain.linearRampToValueAtTime(0.07, now + 3);
    droneLp.connect(droneGain).connect(breathGain);
    const drone: OscillatorNode[] = [];
    for (const type of ['sawtooth', 'triangle', 'sine'] as OscillatorType[]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = type === 'sawtooth' ? -6 : 6;
      o.connect(droneLp);
      o.start(now);
      drone.push(o);
      nodes.push(o);
    }

    // 雨与风：循环的噪声，分别过高通 / 带通
    const noiseSrc = (rate = 1) => {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      n.loop = true;
      n.playbackRate.value = rate;
      n.start(now, Math.random());
      nodes.push(n);
      return n;
    };
    const rain = ctx.createGain();
    rain.gain.value = 0;
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 1400;
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 7000;
    noiseSrc(0.9).connect(rainHp).connect(rainLp).connect(rain).connect(bus);
    const wind = ctx.createGain();
    wind.gain.value = 0;
    const windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass';
    windBp.Q.value = 1.2;
    windBp.frequency.value = 500;
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.07;
    const windDepth = ctx.createGain();
    windDepth.gain.value = 300;
    windLfo.connect(windDepth).connect(windBp.frequency);
    windLfo.start(now);
    nodes.push(windLfo);
    noiseSrc(0.5).connect(windBp).connect(wind).connect(bus);

    this.scapeLayers = {
      bus: breathGain,
      drone,
      rain,
      wind,
      breath: this.scape?.breath ?? null,
      stop: () => {
        const t = ctx.currentTime;
        bus.gain.setTargetAtTime(0.0001, t, 0.4);
        for (const n of nodes) n.stop(t + 2);
        setTimeout(() => bus.disconnect(), 2500);
      },
    };
  }

  private teardownScape() {
    this.scapeLayers?.stop();
    this.scapeLayers = null;
  }

  /** 嗡鸣跟着当前的调（包括定调后的移调）走 */
  private retuneDrone() {
    const L = this.scapeLayers;
    if (!L) return;
    const root = 38 + ((this.song.key.tonic + this.transpose) % 12 + 12) % 12; // D2 附近
    const hz = [midiToHz(root), midiToHz(root + 7), midiToHz(root + 12)];
    L.drone.forEach((o, i) => o.frequency.setTargetAtTime(hz[i]!, this.ctx.currentTime, 0.8));
  }

  setSong(id: string) {
    const s = SONGS.find((x) => x.id === id);
    if (!s || s === this.song) return;
    if (this.playing) this.pendingSong = s;
    else this.applySong(s);
  }

  private applySong(s: Song) {
    this.song = s;
    this.mode = s.key.mode;
    this.freeBpm = s.bpm;
    if (!this.lock) this.period = 60 / s.bpm;
  }

  /** 没有锁定环境拍子时的速度（例如用地点的共鸣指纹预调） */
  setFreeTempo(bpm: number) {
    this.freeBpm = bpm;
  }

  setLock(lock: Lock | null) {
    this.lock = lock;
  }

  /** 移调与调式在下一个小节线生效 */
  setTonality(semis: number, mode: Mode) {
    if (!this.playing) {
      this.transpose = semis;
      this.mode = mode;
      return;
    }
    this.pendingTranspose = semis;
    this.pendingMode = mode;
  }

  setDensity(v: number) {
    this.density = Math.max(0.1, Math.min(1, v));
  }

  setBrightness(v: number) {
    this.brightness = Math.max(0, Math.min(1, v));
    const hz = 700 * 2 ** (this.brightness * 4.2); // 700 Hz – 13 kHz
    this.tone.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.3);
  }

  setSpace(id: SpaceId) {
    this.space = id;
    const sp = SPACES[id];
    this.verb.buffer = impulse(this.ctx, sp.seconds);
    this.wet.gain.setTargetAtTime(sp.wet * 2.2, this.ctx.currentTime, 0.4);
  }

  /** 侧链：环境里的一个重音轻推音乐 */
  duck() {
    const g = this.duckGain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.72, now + 0.012);
    g.setTargetAtTime(1, now + 0.03, 0.06);
  }

  /** 把麦克风接进录制支路（不接扬声器，避免啸叫） */
  attachMic(src: AudioNode | null) {
    if (src) src.connect(this.micRec);
  }

  /** 录一段共鸣片段 */
  record(seconds: number, onProgress?: (p: number) => void): Promise<Blob> {
    if (this.recorder) return Promise.reject(new Error('正在录制'));
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mimeType = types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(this.recDest.stream, mimeType ? { mimeType } : undefined);
    this.recorder = rec;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const iv = setInterval(() => onProgress?.(Math.min(1, (performance.now() - t0) / (seconds * 1000))), 100);
      rec.onstop = () => {
        clearInterval(iv);
        this.recorder = null;
        resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.onerror = () => {
        clearInterval(iv);
        this.recorder = null;
        reject(new Error('录制失败'));
      };
      rec.start(250);
      setTimeout(() => rec.state !== 'inactive' && rec.stop(), seconds * 1000);
    });
  }

  // ------------------------------------------------------------ 调度

  private tick() {
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    while (this.nextStepTime < horizon) {
      const i = this.step % 16;
      if (i === 0) this.onBar();
      if (i % 4 === 0) this.onBeat();
      const stepDur = this.period / 4;
      const t = this.nextStepTime + (i % 2 === 1 ? this.song.swing * stepDur : 0);
      this.playStep(i, t, stepDur);
      this.nextStepTime += stepDur;
      this.step++;
    }
  }

  private onBar() {
    if (this.pendingSong) {
      this.applySong(this.pendingSong);
      this.pendingSong = null;
      this.bar = 0;
    }
    const retune = this.pendingTranspose !== null && this.pendingTranspose !== this.transpose;
    if (this.pendingTranspose !== null) this.transpose = this.pendingTranspose;
    if (this.pendingMode) this.mode = this.pendingMode;
    this.pendingTranspose = null;
    this.pendingMode = null;
    if (retune || this.song.generative) this.retuneDrone();
  }

  /** 每一拍：速度向目标滑动，相位向环境网格修正 */
  private onBeat() {
    const lock = this.lock;
    if (lock) {
      const target = lock.period / lock.ratio;
      this.period += (target - this.period) * 0.35;
      const err = gridError(this.nextStepTime, lock.beat - this.latency, target);
      this.phaseError = err;
      const corr = Math.max(-0.06 * this.period, Math.min(0.06 * this.period, err * 0.5));
      this.nextStepTime = Math.max(this.ctx.currentTime + 0.005, this.nextStepTime + corr);
    } else {
      this.period += (60 / this.freeBpm - this.period) * 0.15;
      this.phaseError = 0;
    }
    this.beats.push(this.nextStepTime);
    if (this.beats.length > 16) this.beats.shift();
  }

  private playStep(i: number, t: number, stepDur: number) {
    if (this.song.generative && this.scape) {
      if (i === 15) this.bar++;
      this.playScape(i, t, stepDur, this.scape);
      return;
    }
    const s = this.song;
    const dens = this.density;
    const barIdx = this.bar % s.chords.length;
    if (i === 15) this.bar++;
    const chordDeg = s.chords[barIdx]!;
    const T = s.key.tonic + this.transpose;
    const mode = this.mode;

    // 鼓
    const k = s.drums.kick[i];
    if (k === 'x' && (dens >= 0.3 || i === 0)) this.kick(t, 1);
    const sn = s.drums.snare[i];
    if (sn === 'x' && dens >= 0.25) this.snare(t, 0.9);
    if (sn === 'o' && dens >= 0.5) this.snare(t, 0.35);
    const h = s.drums.hat[i];
    if (h === 'x' && dens >= 0.35) this.hat(t, 0.8, false);
    if (h === 'o' && dens >= 0.55) this.hat(t, 0.4, false);
    if (s.drums.ohat?.[i] === 'x' && dens >= 0.7) this.hat(t, 0.6, true);

    // 和弦铺底：每小节一次
    if (i === 0) {
      const tones = chordSemis(chordDeg, mode, s.sevenths).map((x) => 60 + T + x - 12 + (x < 5 ? 12 : 0));
      this.pad(t, tones, stepDur * 16);
    }

    // 贝斯
    const b = s.bass[i];
    if (b !== null && b !== undefined) {
      let len = 1;
      while (i + len < 16 && s.bass[i + len] === null && len < 4) len++;
      this.bassNote(t, 36 + T + degreeSemis(chordDeg + b - 1, mode), stepDur * len * 0.95);
    }

    // 琶音
    const a = s.arp?.[i];
    if (a !== null && a !== undefined && dens >= 0.5) {
      const tones = chordSemis(chordDeg, mode, s.sevenths);
      const semis = tones[a % tones.length]! + 12 * Math.floor(a / tones.length);
      this.pluck(t, 60 + T + semis, stepDur * 1.6, 0.55);
    }

    // 旋律
    const m = s.melody[barIdx]?.[i];
    if (m !== null && m !== undefined && dens >= 0.2) {
      let len = 1;
      while (i + len < 16 && s.melody[barIdx]![i + len] === null && len < 6) len++;
      this.lead(t, 72 + T - 12 + degreeSemis(m, mode), stepDur * len);
    }
  }

  /** 声景的即兴：每两小节换一个和弦，五声音阶的钟琴随机落下，有步子时加一层很轻的脉冲 */
  private playScape(i: number, t: number, stepDur: number, plan: ScapePlan) {
    const T = this.song.key.tonic + this.transpose;
    const mode = this.mode;
    const minor = mode === 'minor';
    if (i === 0 && this.bar % 2 === 0) {
      this.scapeChord = this.bar === 0 ? 1 : nextChord(this.scapeChord, minor, Math.random);
      const tones = chordSemis(this.scapeChord, mode, true).map((x) => 60 + T + x - 12 + (x < 5 ? 12 : 0));
      this.pad(t, tones, stepDur * 32);
      this.bassNote(t, 36 + T + degreeSemis(this.scapeChord, mode), stepDur * 30);
    }
    if (i % 2 === 0 && Math.random() < plan.bell * (0.6 + this.density)) {
      const pent = PENTA[mode];
      const deg = pent[Math.floor(Math.random() * pent.length)]! + (Math.random() < 0.35 ? 7 : 0);
      this.lead(t, 72 + T - 12 + degreeSemis(deg, mode), stepDur * 6);
    }
    if (plan.pulse > 0) {
      if (i % 4 === 0) this.kick(t, 0.35 * plan.pulse);
      if (i % 2 === 0 && plan.pulse > 0.5) this.hat(t, 0.35 * plan.pulse, false);
    }
    if (plan.rain > 0.3 && Math.random() < plan.rain * 0.12) {
      // 雨滴：极短的高音
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 2400 + Math.random() * 2600;
      const t2 = t + Math.random() * stepDur;
      const g = this.env(t2, 0.03, 0.001, 0.05);
      o.connect(g).connect(this.music);
      o.start(t2);
      o.stop(t2 + 0.1);
    }
  }

  // ------------------------------------------------------------ 乐器

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private kick(t: number, vel: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.env(t, 0.95 * vel, 0.004, 0.34);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.4);
  }

  private snare(t: number, vel: number) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    const g = this.env(t, 0.42 * vel, 0.002, 0.17);
    n.connect(bp).connect(g).connect(this.music);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.22);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const og = this.env(t, 0.22 * vel, 0.002, 0.08);
    o.connect(og).connect(this.music);
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, vel: number, open: boolean) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7600;
    const g = this.env(t, 0.16 * vel, 0.002, open ? 0.24 : 0.045);
    n.connect(hp).connect(g).connect(this.music);
    n.start(t, Math.random() * 0.5);
    n.stop(t + (open ? 0.3 : 0.08));
  }

  private bassNote(t: number, midi: number, dur: number) {
    const f = midiToHz(midi);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.38, t + 0.01);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.05);
    const oscs: OscillatorNode[] = [];
    if (this.song.sound.bass === 'sub') {
      lp.frequency.value = 420;
      for (const [type, mul] of [['sine', 1], ['triangle', 2]] as const) {
        const o = this.ctx.createOscillator();
        o.type = type;
        o.frequency.value = f * mul;
        oscs.push(o);
      }
    } else {
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.exponentialRampToValueAtTime(1100, t + 0.03);
      lp.frequency.exponentialRampToValueAtTime(320, t + 0.25);
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      oscs.push(o);
    }
    for (const o of oscs) {
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.4);
    }
    lp.connect(g).connect(this.music);
  }

  private pad(t: number, midis: number[], dur: number) {
    const kind = this.song.sound.pad;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'warm' ? 1300 : kind === 'saw' ? 2400 : 3600;
    const g = this.ctx.createGain();
    const level = kind === 'glass' ? 0.05 : 0.045;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + Math.min(0.5, dur * 0.2));
    g.gain.setValueAtTime(level, t + dur * 0.92);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.5);
    lp.connect(g).connect(this.music);
    for (const m of midis) {
      const f = midiToHz(m);
      const types: OscillatorType[] = kind === 'warm' ? ['triangle', 'sawtooth'] : kind === 'saw' ? ['sawtooth', 'sawtooth'] : ['sine', 'triangle'];
      types.forEach((type, j) => {
        const o = this.ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = j === 0 ? -7 : 7;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.6);
      });
    }
  }

  private pluck(t: number, midi: number, dur: number, vel: number) {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = midiToHz(midi);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.2);
    const g = this.env(t, 0.06 * vel, 0.003, Math.max(0.12, dur));
    o.connect(lp).connect(g).connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.3);
  }

  private lead(t: number, midi: number, dur: number) {
    const kind = this.song.sound.lead;
    const f = midiToHz(midi);
    if (kind === 'pluck') return this.pluck(t, midi + 12, dur, 1.2);
    const partials: [number, number, number][] =
      kind === 'rhodes'
        ? [[1, 0.13, Math.max(0.6, dur * 1.4)], [2, 0.04, 0.25], [3, 0.012, 0.12]]
        : [[1, 0.1, Math.max(0.8, dur * 1.8)], [2.76, 0.035, 0.4], [5.4, 0.012, 0.18]];
    for (const [mul, peak, decay] of partials) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      const g = this.env(t, peak, 0.006, decay);
      o.connect(g).connect(this.music);
      o.start(t);
      o.stop(t + 0.01 + decay + 0.05);
    }
  }
}

/** 指数衰减的立体声噪声脉冲响应 = 一个简单的混响空间 */
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
  }
  return buf;
}
