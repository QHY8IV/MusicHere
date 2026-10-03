import { useEffect, useRef } from 'react';
import { pcName } from '../lib/resonance/dsp';
import type { ResonanceEngine } from '../lib/resonance/engine';
import type { EnvListener } from '../lib/resonance/listener';

/**
 * 共鸣可视化（canvas，60 fps，不经过 React 渲染）：
 * - 外圈「调性轮」：12 个音级的环境能量（紫），歌曲当前的主音（青柠描边），环境的主导音（紫点）；
 * - 涟漪：环境里每一个重音；
 * - 两根「指针」：紫色是世界的拍子相位，青柠是歌曲的拍子相位——对拍成功时两根指针重合；
 * - 中心的球：随歌曲的拍子跳动，显示当前速度。
 */
export function ResonanceViz({
  engine,
  listener,
  hits,
  size,
}: {
  engine: React.RefObject<ResonanceEngine | null>;
  listener: React.RefObject<EnvListener | null>;
  hits: React.RefObject<number[]>;
  size: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const g = canvas.getContext('2d')!;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size, size);
      const S = size;
      const c = S / 2;
      const eng = engine.current;
      const lis = listener.current;
      const now = eng ? eng.ctx.currentTime : performance.now() / 1000;
      const snap = lis?.snapshot();
      const st = eng?.state();
      const locked = !!st?.locked && !!st.playing;

      // 底色光晕
      const bg = g.createRadialGradient(c, c, S * 0.05, c, c, S * 0.5);
      bg.addColorStop(0, locked ? 'rgba(183,243,107,0.16)' : 'rgba(160,139,255,0.14)');
      bg.addColorStop(1, 'rgba(7,8,12,0)');
      g.fillStyle = bg;
      g.fillRect(0, 0, S, S);

      // 调性轮
      const rIn = S * 0.37;
      const rOut = S * 0.47;
      const chroma = snap?.chroma ?? new Array(12).fill(0);
      const maxC = Math.max(0.0001, ...chroma);
      const songTonic = st?.key.tonic ?? -1;
      const envPc = snap?.tonality.kind === 'drone' ? snap.tonality.pc : snap?.tonality.kind === 'key' ? snap.tonality.key.tonic : -1;
      for (let i = 0; i < 12; i++) {
        const a0 = -Math.PI / 2 + ((i - 0.5) * Math.PI * 2) / 12 + 0.02;
        const a1 = -Math.PI / 2 + ((i + 0.5) * Math.PI * 2) / 12 - 0.02;
        const v = chroma[i]! / maxC;
        g.beginPath();
        g.arc(c, c, rOut, a0, a1);
        g.arc(c, c, rIn, a1, a0, true);
        g.closePath();
        g.fillStyle = `rgba(160,139,255,${0.07 + 0.75 * v * v})`;
        g.fill();
        if (i === songTonic && st?.playing) {
          g.lineWidth = 2.5;
          g.strokeStyle = '#B7F36B';
          g.stroke();
        }
        const am = -Math.PI / 2 + (i * Math.PI * 2) / 12;
        g.fillStyle = i === songTonic && st?.playing ? '#B7F36B' : 'rgba(244,245,247,0.55)';
        g.font = `700 ${Math.round(S * 0.032)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(pcName(i), c + Math.cos(am) * (rIn + rOut) * 0.5, c + Math.sin(am) * (rIn + rOut) * 0.5);
        if (i === envPc) {
          g.beginPath();
          g.arc(c + Math.cos(am) * (rOut + S * 0.022), c + Math.sin(am) * (rOut + S * 0.022), S * 0.012, 0, Math.PI * 2);
          g.fillStyle = '#A08BFF';
          g.fill();
        }
      }

      // 环境重音的涟漪
      const hs = hits.current ?? [];
      while (hs.length && now - hs[0]! > 1) hs.shift();
      for (const t of hs) {
        const age = now - t;
        if (age < 0) continue;
        g.beginPath();
        g.arc(c, c, S * 0.18 + age * S * 0.2, 0, Math.PI * 2);
        g.strokeStyle = `rgba(92,200,255,${Math.max(0, 0.7 * (1 - age))})`;
        g.lineWidth = 2;
        g.stroke();
      }

      // 相位指针：世界（紫）与歌曲（青柠）
      const track = S * 0.3;
      g.beginPath();
      g.arc(c, c, track, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      g.lineWidth = 1;
      g.stroke();
      const dot = (phase: number, color: string, r: number) => {
        const a = -Math.PI / 2 + phase * Math.PI * 2;
        const x = c + Math.cos(a) * track;
        const y = c + Math.sin(a) * track;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = color;
        g.shadowColor = color;
        g.shadowBlur = 12;
        g.fill();
        g.shadowBlur = 0;
      };
      const envBeat = snap?.beat;
      if (envBeat && eng && st?.playing) {
        const ratio = eng.lock?.ratio ?? 1;
        const p = envBeat.period / ratio;
        const ph = (((now - (envBeat.beat - eng.latency)) / p) % 1 + 1) % 1;
        dot(ph, '#A08BFF', S * 0.022);
      }
      let pulse = 0;
      if (eng && st?.playing) {
        const beats = eng.beats.filter((b) => b <= now);
        const last = beats[beats.length - 1];
        if (last !== undefined) {
          const p = 60 / st.bpm;
          dot((((now - last) / p) % 1 + 1) % 1, '#B7F36B', S * 0.016);
          pulse = Math.exp(-(now - last) / 0.11);
        }
      }

      // 中心球
      const r = S * 0.17 * (1 + 0.1 * pulse);
      const orb = g.createRadialGradient(c - r * 0.3, c - r * 0.35, r * 0.1, c, c, r);
      if (locked) {
        orb.addColorStop(0, '#E4FF9A');
        orb.addColorStop(0.6, '#7FF0A0');
        orb.addColorStop(1, '#3EE6C1');
      } else if (st?.playing) {
        orb.addColorStop(0, '#C9BFFF');
        orb.addColorStop(1, '#5A4FB5');
      } else {
        orb.addColorStop(0, '#2A2F3F');
        orb.addColorStop(1, '#151822');
      }
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.fillStyle = orb;
      g.fill();
      g.fillStyle = st?.playing ? '#07080C' : 'rgba(244,245,247,0.8)';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (st?.playing) {
        g.font = `900 ${Math.round(S * 0.085)}px system-ui, sans-serif`;
        g.fillText(String(Math.round(st.bpm)), c, c - S * 0.012);
        g.font = `800 ${Math.round(S * 0.03)}px system-ui, sans-serif`;
        g.fillText(locked ? 'BPM · 已对拍' : 'BPM', c, c + S * 0.06);
      } else {
        g.font = `800 ${Math.round(S * 0.04)}px system-ui, sans-serif`;
        g.fillText('共鸣', c, c);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [engine, listener, hits, size]);

  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} data-testid="res-viz" />;
}
