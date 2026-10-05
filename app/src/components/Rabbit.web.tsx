import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { consumeAutoDemo } from '../lib/demo';
import { fitTempo } from '../lib/resonance/dsp';
import { ResonanceEngine } from '../lib/resonance/engine';
import { EnvListener } from '../lib/resonance/listener';
import {
  buildReport,
  control,
  DropTracker,
  phaseAt,
  SIM,
  simInit,
  simStep,
  songBpmFor,
  type Phase,
  type RabbitPlan,
  type Report,
  type Sample,
  type SimState,
} from '../lib/resonance/rabbit';
import { onBeat, pickSongForCadence } from '../lib/resonance/run';
import { SONGS, type Song } from '../lib/resonance/songs';
import { colors, radius } from '../lib/theme';
import { RabbitChart, renderReportPng } from './RabbitChart.web';
import { Button, Chip, Pill, Screen, Segmented, Txt } from './ui';

/**
 * 兔子电台：马拉松里的配速兔，现在在你的耳机里。
 *
 *   热身（跟随）→ 带跑（掉速了才领先 3%）→ 冷却（节拍渐慢、淡出）→ 成绩单
 *
 * 不需要麦克风、AudioWorklet 或 HTTPS：只用加速度计（真跑）或「模拟跑者」（演示）。
 * 模拟跑者把合成的加速度送进和真实传感器同一条管线，步数检测、步频估计、锁相全部照常工作。
 */

const TARGETS = [160, 168, 176] as const;
const PHASES: { key: Phase; label: string }[] = [
  { key: 'warmup', label: '热身' },
  { key: 'pace', label: '带跑' },
  { key: 'cooldown', label: '冷却' },
];

interface Live {
  st: number;
  phase: Phase;
  cadence: number | null;
  music: number | null;
  lead: number;
  label: string;
  dropped: boolean;
  drops: number;
  recoveries: number;
  series: Sample[];
  onBeat: number | null;
}

interface Run {
  ctx: AudioContext;
  eng: ResonanceEngine;
  lis: EnvListener;
  song: Song;
  plan: RabbitPlan;
  tracker: DropTracker;
  simulated: boolean;
  t0: number;
  finishAt: number | null;
  coolStart: number | null;
  faded: boolean;
  music: number;
  lock: boolean;
  series: Sample[];
  lastSample: number;
  hits: boolean[];
  sim: SimState;
  nextStep: number;
  impulse: number;
  lastTick: number;
  timers: ReturnType<typeof setInterval>[];
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function RabbitScreen() {
  const router = useRouter();
  const [target, setTarget] = useState<number>(168);
  const [source, setSource] = useState<'sim' | 'real'>('sim');
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [report, setReport] = useState<{ r: Report; song: string; png: string } | null>(null);
  const run = useRef<Run | null>(null);

  const cleanup = useCallback(() => {
    const r = run.current;
    if (!r) return;
    r.timers.forEach(clearInterval);
    r.eng.stop();
    r.lis.stop();
    void r.ctx.close().catch(() => {});
    run.current = null;
    setRunning(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const finish = useCallback(() => {
    const r = run.current;
    if (!r) return;
    const st = (performance.now() - r.t0) / 1000;
    const rep = buildReport({ seconds: st, plan: r.plan, series: r.series, tracker: r.tracker, hits: r.hits, simulated: r.simulated });
    const png = renderReportPng(rep, r.song.title);
    cleanup();
    setLive(null);
    setReport({ r: rep, song: r.song.title, png });
  }, [cleanup]);

  const start = useCallback(
    async (forceSim = false) => {
      setStarting(true);
      setError(null);
      setReport(null);
      const simulated = forceSim || source === 'sim';
      try {
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        await ctx.resume();
        const eng = new ResonanceEngine(ctx);
        const song = pickSongForCadence(target, SONGS);
        eng.setSong(song.id);
        const lis = new EnvListener(ctx);
        lis.beatSource = 'motion';
        lis.motionPref = 165;
        lis.motionMin = 120;

        let plan: RabbitPlan;
        if (simulated) {
          lis.enableSim();
          plan = SIM.plan(target);
        } else {
          if (!(await lis.startMotion())) {
            void ctx.close();
            setError('没有拿到加速度计：请用手机浏览器打开（iPhone 需要允许「动作与方向」），或改用「模拟跑者」。');
            return;
          }
          plan = { target, warmup: 180, cooldown: 60 };
        }

        const r: Run = {
          ctx,
          eng,
          lis,
          song,
          plan,
          tracker: new DropTracker(target),
          simulated,
          t0: performance.now(),
          finishAt: simulated ? SIM.finishAt : null,
          coolStart: null,
          faded: false,
          music: SIM.start,
          lock: false,
          series: [],
          lastSample: -1,
          hits: [],
          sim: simInit(),
          nextStep: 0.4,
          impulse: -1,
          lastTick: performance.now(),
          timers: [],
        };
        run.current = r;

        eng.setFreeTempo(songBpmFor(simulated ? SIM.start : 150, song.bpm));
        eng.start();

        // 每一步落地时，看它有没有踩在歌的拍点上（只统计锁定跟随的时候）
        lis.onStep = (t) => {
          if (!eng.playing || !r.lock) return;
          const last = eng.beats.filter((b) => b <= t).pop();
          if (last === undefined) return;
          r.hits.push(onBeat(t, last + eng.latency, 60 / eng.bpm, eng.lock?.ratio ?? 1));
          if (r.hits.length > 400) r.hits.splice(0, 200);
        };

        // 模拟跑者：约 60 Hz 合成加速度（重力 + 每步一个落地冲击）
        if (simulated) {
          let seed = 11;
          const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1;
          r.timers.push(
            setInterval(() => {
              const now = performance.now();
              const dt = Math.min(0.1, (now - r.lastTick) / 1000);
              r.lastTick = now;
              const st = (now - r.t0) / 1000;
              const ph = phaseAt(st, r.plan, r.finishAt);
              if (ph === 'done') return;
              // 锁定时音乐是跟着跑者的脚步走的，对跑者没有「拉力」；只有领先 / 冷却时音乐的速度才会带动他
              r.sim = simStep(r.sim, st, dt, r.lock ? r.sim.cadence : r.music, ph, r.plan);
              while (st >= r.nextStep) {
                r.impulse = r.nextStep;
                r.nextStep += (60 / (r.sim.cadence + rnd() * 0.6)) * (1 + rnd() * 0.01);
              }
              const since = st - r.impulse;
              const hit = since >= 0 && since < 0.09 ? 7 * Math.sin((Math.PI * since) / 0.09) : 0;
              lis.injectMotion(9.81 + hit + rnd() * 0.15);
            }, 16),
          );
        }

        // 控制回路：每 200 ms 把步频交给「兔子」
        r.timers.push(
          setInterval(() => {
            const st = (performance.now() - r.t0) / 1000;
            const phase = phaseAt(st, r.plan, r.finishAt);
            if (phase === 'done') {
              finish();
              return;
            }
            const env = lis.snapshot();
            const cad = env.cadence;
            r.tracker.update(st, cad, phase);
            if (phase === 'cooldown' && r.coolStart === null && cad) r.coolStart = cad;
            let label = '正在数你的步子…';
            let lead = 0;
            if (cad && env.beat) {
              const c = control(phase, cad, r.plan, r.tracker, r.coolStart === null ? null : { startCadence: r.coolStart, progress: (st - r.finishAt!) / r.plan.cooldown });
              r.music = c.music;
              r.lock = c.lock;
              lead = c.lead;
              label = c.label;
              if (c.lock) eng.setLock({ period: env.beat.period, beat: env.beat.beat, ratio: fitTempo(env.beat.bpm, song.bpm).ratio });
              else {
                eng.setLock(null);
                eng.setFreeTempo(songBpmFor(c.music, song.bpm));
              }
            }
            if (phase === 'cooldown' && !r.faded) {
              r.faded = true;
              eng.fadeOut(r.plan.cooldown);
            }
            if (st - r.lastSample >= 1) {
              r.lastSample = st;
              r.series.push({ t: st, cadence: cad, music: r.music, dropped: r.tracker.state === 'dropped', phase });
            }
            const hits = r.hits.slice(-32);
            setLive({
              st,
              phase,
              cadence: cad,
              music: cad ? r.music : null,
              lead,
              label,
              dropped: r.tracker.state === 'dropped' && phase === 'pace',
              drops: r.tracker.drops,
              recoveries: r.tracker.recoveries,
              series: [...r.series],
              onBeat: hits.length >= 8 ? hits.filter(Boolean).length / hits.length : null,
            });
          }, 200),
        );
        setRunning(true);
      } catch (err) {
        cleanup();
        setError(err instanceof Error ? err.message : '无法启动音频');
      } finally {
        setStarting(false);
      }
    },
    [source, target, cleanup, finish],
  );

  // 欢迎页点了「看兔子带跑」：进来就自动开始模拟
  useEffect(() => {
    if (!consumeAutoDemo()) return;
    setSource('sim');
    void start(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wrapUp = () => {
    const r = run.current;
    if (!r || r.finishAt !== null) return;
    const st = (performance.now() - r.t0) / 1000;
    r.finishAt = Math.max(st, r.plan.warmup);
  };

  const phase = live?.phase;
  const banner = live?.dropped ? colors.red : live?.phase === 'cooldown' ? colors.sky : colors.lime;

  return (
    <Screen testID="screen-rabbit" glow={colors.lime}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Txt v="display">兔子电台</Txt>
          <Pill label="PACER RADIO" color={colors.lime} />
        </View>
        <Txt v="sub">马拉松里的配速兔，现在在你的耳机里。步频掉了，音乐先快一点点，把你带回去；回来了，再陪你踩着拍子跑。</Txt>
      </View>

      {!running && !report ? (
        <View style={styles.card}>
          <Txt v="label">目标步频（步 / 分）</Txt>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {TARGETS.map((t) => (
              <Chip key={t} label={`${t}`} selected={target === t} onPress={() => setTarget(t)} testID={`rabbit-target-${t}`} />
            ))}
          </View>
          <Segmented<'sim' | 'real'>
            value={source}
            onChange={setSource}
            options={[
              { key: 'sim', label: '模拟跑者 · 75 秒', testID: 'rabbit-src-sim' },
              { key: 'real', label: '真跑（手机）', testID: 'rabbit-src-real' },
            ]}
          />
          <Txt v="caption">
            {source === 'sim'
              ? '在电脑上把一次完整的跑演一遍：热身 8 秒 → 带跑 56 秒（体力会下滑两次）→ 冷却 12 秒。模拟跑者的脚步走的是和真实加速度计同一条检测管线。'
              : '把手机放进臂包或口袋，戴上耳机开跑。热身 3 分钟，之后随时点「收工」进入 1 分钟冷却。真跑需要手机浏览器的加速度计权限。'}
          </Txt>
          <Button label={source === 'sim' ? '看兔子带跑' : '开始跑'} icon="walk" variant="aurora" size="lg" onPress={() => void start()} loading={starting} testID="rabbit-start" />
          {error ? <Txt v="caption" style={{ color: colors.sunset }}>{error}</Txt> : null}
        </View>
      ) : null}

      {running && live ? (
        <View style={styles.card} testID="rabbit-live">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {PHASES.map((p) => (
              <Pill key={p.key} label={p.label} color={phase === p.key ? colors.lime : colors.faint} solid={phase === p.key} />
            ))}
            <View style={{ flex: 1 }} />
            <Text style={styles.time}>{mmss(live.st)}</Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View>
              <Txt v="label">你的步频</Txt>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <Text style={styles.big} testID="rabbit-cadence">
                  {live.cadence ? Math.round(live.cadence) : '—'}
                </Text>
                <Text style={styles.unit}>步 / 分</Text>
              </View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Txt v="label">音乐（兔子）</Txt>
              <Text style={[styles.mid, { color: colors.violet }]} testID="rabbit-music">
                {live.music ? Math.round(live.music) : '—'}
                {live.lead > 0.004 ? `  +${Math.round(live.lead * 100)}%` : live.lead < -0.004 ? `  ${Math.round(live.lead * 100)}%` : ''}
              </Text>
            </View>
          </View>

          <View style={[styles.banner, { borderColor: banner }]} testID="rabbit-banner">
            <LinearGradient colors={[`${banner}33`, `${banner}08`]} style={StyleSheet.absoluteFill} />
            <Ionicons name={live.dropped ? 'trending-down' : live.phase === 'cooldown' ? 'leaf' : 'footsteps'} size={18} color={banner} />
            <Text style={[styles.bannerText, { color: banner }]}>{live.label}</Text>
          </View>

          <RabbitChart series={live.series} target={target} windowS={60} />
          <View style={styles.legend}>
            <Legend color={colors.lime} label="你的步频" />
            <Legend color={colors.violet} label="兔子（音乐速度）" />
            <Legend color={colors.red} label="掉速时段" />
          </View>

          <View style={styles.stats}>
            <Stat label="掉速" value={`${live.drops}`} />
            <Stat label="被带回" value={`${live.recoveries}`} />
            <Stat label="跟随合拍率" value={live.onBeat === null ? '—' : `${Math.round(live.onBeat * 100)}%`} />
          </View>

          {run.current?.simulated ? <Pill label="模拟跑者（模型）：「被音乐带动」的强度是我设的参数，不是真人实测" icon="flask" color={colors.sky} /> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label={phase === 'cooldown' ? '冷却中…' : '收工 · 开始冷却'} icon="flag" variant="subtle" onPress={wrapUp} disabled={phase === 'cooldown' || phase === 'warmup'} style={{ flex: 1 }} testID="rabbit-wrap" />
            <Button label="停止" icon="stop" variant="subtle" onPress={() => { cleanup(); setLive(null); }} style={{ flex: 1 }} testID="rabbit-stop" />
          </View>
        </View>
      ) : null}

      {report ? (
        <View style={styles.card} testID="rabbit-report">
          <Txt v="title">跑后成绩单</Txt>
          {report.r.simulated ? <Pill label="模拟跑者（模型演示），不是真人数据" icon="flask" color={colors.sky} /> : null}
          <View style={styles.stats}>
            <Stat label="平均步频（带跑段）" value={report.r.avgCadence ? `${Math.round(report.r.avgCadence)}` : '—'} />
            <Stat label="时长" value={mmss(report.r.seconds)} />
          </View>
          <View style={styles.stats}>
            <Stat label="掉速 → 被带回" value={`${report.r.drops} → ${report.r.recoveries}`} testID="rabbit-report-drops" />
            <Stat label="平均回来用时" value={report.r.avgRecovery !== null ? `${Math.round(report.r.avgRecovery)} 秒` : '—'} />
          </View>
          <RabbitChart series={report.r.series} target={report.r.target} />
          {report.r.events.map((e, i) => (
            <Txt key={i} v="caption" style={{ color: colors.sub }}>
              {`第 ${Math.round(e.at)} 秒 步频掉到 ${Math.round(e.cadence)} → 兔子领先 3% → ${e.recoveredIn !== null ? `${Math.round(e.recoveredIn)} 秒后回到 ${report.r.target}` : '到收工还没回来'}`}
            </Txt>
          ))}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              label="保存成绩单"
              icon="download"
              variant="subtle"
              style={{ flex: 1 }}
              onPress={() => {
                const a = document.createElement('a');
                a.href = report.png;
                a.download = '兔子电台-跑后成绩单.png';
                a.click();
              }}
              testID="rabbit-download"
            />
            <Button label="再跑一次" icon="refresh" variant="aurora" style={{ flex: 1 }} onPress={() => setReport(null)} testID="rabbit-again" />
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <Txt v="title">它是怎么带你的</Txt>
        <Txt v="sub">
          1. 加速度计数你的步子，估出步频，音乐锁在你的脚步上（热身和平时不催你）。{'\n'}
          2. 步频掉到目标以下 {4} 步并持续 2 秒（不是抬了一下脚），兔子才出手：音乐先快一点点（最多 3%，不锁相位），你会不自觉地跟上去。{'\n'}
          3. 回到目标附近稳住 2 秒，再锁回你的脚步。{'\n'}
          4. 收工后进入冷却：节拍从当前步频一路降到 120，音量淡出，自动收尾，不让你听完又去摸手机。
        </Txt>
        <Txt v="caption">
          落地到 QQ 音乐：曲库离线算好每首歌的 BPM 和节拍网格，播放时在 ±10–15% 内实时变速即可，不需要分轨；超出就改为按步频选下一首。当前 Demo 用的是实时合成的原创曲。
        </Txt>
        <Button label="街头共鸣（同一个引擎的另一面）" icon="pulse" variant="subtle" size="sm" onPress={() => router.push('/resonance')} testID="rabbit-to-resonance" />
      </View>
    </Screen>
  );
}

function Stat({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={styles.statValue} testID={testID}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ color: colors.sub, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  time: { color: colors.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  big: { color: colors.text, fontSize: 64, fontWeight: '900', fontVariant: ['tabular-nums'] },
  unit: { color: colors.sub, fontSize: 14, fontWeight: '700' },
  mid: { fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'] },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  bannerText: { flex: 1, fontSize: 14, fontWeight: '800' },
  legend: { flexDirection: 'row', gap: 14, flexWrap: 'wrap', justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: 8 },
  statValue: { color: colors.text, fontSize: 24, fontWeight: '900' },
  statLabel: { color: colors.faint, fontSize: 12, textAlign: 'center' },
});
