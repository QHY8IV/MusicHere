import { colors } from '../lib/theme';
import type { Report, Sample } from '../lib/resonance/rabbit';

/** 步频（绿）、音乐速度（紫）、目标线（虚线）；掉速的时段用红色底标出来。 */

interface Geo {
  x: (t: number) => number;
  y: (v: number) => number;
  t0: number;
  t1: number;
  lo: number;
  hi: number;
}

function geo(series: Sample[], target: number, w: number, h: number, windowS: number | null, pad = 6): Geo {
  const t1 = Math.max(10, series[series.length - 1]?.t ?? 10);
  const t0 = windowS ? Math.max(0, t1 - windowS) : 0;
  const vals = series.filter((s) => s.t >= t0).flatMap((s) => [s.cadence, s.music].filter((v): v is number => v !== null));
  const lo = Math.min(target - 12, ...vals) - 3;
  const hi = Math.max(target + 4, ...vals) + 3;
  return {
    t0,
    t1,
    lo,
    hi,
    x: (t) => pad + ((t - t0) / (t1 - t0 || 1)) * (w - 2 * pad),
    y: (v) => pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad),
  };
}

function runs(series: Sample[]): [number, number][] {
  const out: [number, number][] = [];
  let a: number | null = null;
  for (const s of series) {
    if (s.dropped && s.phase === 'pace') a ??= s.t;
    else if (a !== null) {
      out.push([a, s.t]);
      a = null;
    }
  }
  if (a !== null) out.push([a, series[series.length - 1]!.t]);
  return out;
}

export function RabbitChart({ series, target, windowS = null, height = 150 }: { series: Sample[]; target: number; windowS?: number | null; height?: number }) {
  const W = 340;
  const g = geo(series, target, W, height, windowS);
  const pts = (key: 'cadence' | 'music') =>
    series
      .filter((s) => s.t >= g.t0 && s[key] !== null)
      .map((s) => `${g.x(s.t).toFixed(1)},${g.y(s[key]!).toFixed(1)}`)
      .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: 'block' }} role="img" aria-label="步频与音乐速度曲线" data-testid="rabbit-chart">
      {runs(series).map(([a, b], i) => (
        <rect key={i} x={g.x(Math.max(a, g.t0))} y={0} width={Math.max(2, g.x(b) - g.x(Math.max(a, g.t0)))} height={height} fill={colors.red} opacity={0.14} />
      ))}
      <line x1={0} x2={W} y1={g.y(target)} y2={g.y(target)} stroke={colors.sub} strokeDasharray="4 4" opacity={0.6} />
      <text x={W - 4} y={g.y(target) - 4} fill={colors.sub} fontSize="10" textAnchor="end">
        目标 {target}
      </text>
      <polyline points={pts('music')} fill="none" stroke={colors.violet} strokeWidth={2} strokeLinejoin="round" opacity={0.9} />
      <polyline points={pts('cadence')} fill="none" stroke={colors.lime} strokeWidth={2.5} strokeLinejoin="round" />
    </svg>
  );
}

// ------------------------------------------------------------ 成绩单 PNG

const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** 1080×1350 的跑后成绩单 */
export function renderReportPng(r: Report, songTitle: string): string {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#16221a');
  bg.addColorStop(0.5, '#0b0e12');
  bg.addColorStop(1, '#07080C');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.8, 120, 10, W * 0.8, 120, 520);
  glow.addColorStop(0, 'rgba(183,243,107,0.28)');
  glow.addColorStop(1, 'rgba(183,243,107,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = colors.lime;
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText('兔子电台 · 跑后成绩单', 80, 130);
  ctx.fillStyle = colors.sub;
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText(`${new Date().toLocaleDateString('zh-CN')} · 《${songTitle}》· 目标 ${r.target} 步/分`, 80, 185);

  const big = (label: string, value: string, x: number, y: number) => {
    ctx.fillStyle = colors.text;
    ctx.font = `900 110px ${FONT}`;
    ctx.fillText(value, x, y);
    ctx.fillStyle = colors.sub;
    ctx.font = `500 30px ${FONT}`;
    ctx.fillText(label, x, y + 48);
  };
  big('平均步频（带跑段）', r.avgCadence ? `${Math.round(r.avgCadence)}` : '—', 80, 360);
  big('时长', mmss(r.seconds), 620, 360);
  big('掉速 → 被带回', `${r.drops} → ${r.recoveries}`, 80, 560);
  big('平均回来用时', r.avgRecovery !== null ? `${Math.round(r.avgRecovery)} 秒` : '—', 620, 560);

  // 曲线
  const cw = W - 160;
  const ch = 420;
  const ox = 80;
  const oy = 680;
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.beginPath();
  ctx.roundRect(ox, oy, cw, ch, 28);
  ctx.fill();
  const g = geo(r.series, r.target, cw, ch, null, 24);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.beginPath();
  ctx.roundRect(0, 0, cw, ch, 28);
  ctx.clip();
  for (const [a, b] of runs(r.series)) {
    ctx.fillStyle = 'rgba(255,92,122,0.16)';
    ctx.fillRect(g.x(a), 0, Math.max(4, g.x(b) - g.x(a)), ch);
  }
  ctx.setLineDash([12, 10]);
  ctx.strokeStyle = 'rgba(167,172,185,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, g.y(r.target));
  ctx.lineTo(cw, g.y(r.target));
  ctx.stroke();
  ctx.setLineDash([]);
  const line = (key: 'cadence' | 'music', color: string, wd: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = wd;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let first = true;
    for (const s of r.series) {
      const v = s[key];
      if (v === null) continue;
      if (first) ctx.moveTo(g.x(s.t), g.y(v));
      else ctx.lineTo(g.x(s.t), g.y(v));
      first = false;
    }
    ctx.stroke();
  };
  line('music', colors.violet, 5);
  line('cadence', colors.lime, 7);
  ctx.restore();

  ctx.font = `500 26px ${FONT}`;
  ctx.fillStyle = colors.lime;
  ctx.fillText('● 你的步频', ox, oy + ch + 50);
  ctx.fillStyle = colors.violet;
  ctx.fillText('● 兔子（音乐速度）', ox + 220, oy + ch + 50);
  ctx.fillStyle = 'rgba(255,92,122,0.9)';
  ctx.fillText('▮ 掉速时段', ox + 560, oy + ch + 50);

  ctx.fillStyle = colors.sub;
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(r.simulated ? '※ 模拟跑者（模型演示），不是真人跑步数据' : `跟随时合拍率 ${r.onBeatRate === null ? '—' : Math.round(r.onBeatRate * 100) + '%'}`, 80, H - 120);
  ctx.fillStyle = colors.faint;
  ctx.fillText('步频掉了，音乐先快一点点，把你带回去。', 80, H - 70);
  return c.toDataURL('image/png');
}
