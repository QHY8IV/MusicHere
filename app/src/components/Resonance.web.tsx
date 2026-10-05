import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { api, type Category, type Engine as AiEngine, type Place, type ResonanceSummary } from '../lib/api';
import { useToast } from '../lib/feedback';
import { checkinAllowanceM } from '../lib/format';
import { consumeAutoDemo } from '../lib/demo';
import { useLocation } from '../lib/location';
import { pickScenePhoto, PickError } from '../lib/pickImage';
import { DEMO_SCENES, type DemoScene } from '../lib/resonance/demo-street';
import { chooseTranspose, fitTempo, keyName, pcName, type Mode, type Tonality } from '../lib/resonance/dsp';
import { ResonanceEngine, SPACES, type EngineState, type SpaceId } from '../lib/resonance/engine';
import { EnvListener, type EnvSnapshot } from '../lib/resonance/listener';
import { guideTempo, onBeat, onBeatRate, pickSongForCadence } from '../lib/resonance/run';
import { fetchWeather, hourLabel, planScape, type ScapeMode, type Weather } from '../lib/resonance/scape';
import { SONGS } from '../lib/resonance/songs';
import { colors, gradients, radius } from '../lib/theme';
import { RunPanel, ScapePanel, type RunView } from './ResonanceModes.web';
import { ResonanceViz } from './ResonanceViz.web';
import { AIBadge, Button, Card, Pill, Screen, Segmented, Txt } from './ui';

/**
 * 共鸣：让世界为你的歌伴奏。三种模式共用一个引擎：
 * - 街头：对拍（环境 / 脚步的节奏）+ 定调（环境的嗡鸣或调性）+ 入景（AI 看画面调混音）；
 * - 跑步：按步频挑歌、锁到脚步上，设了目标步频时用节拍引导把你带过去，并统计合拍率；
 * - 声景：不放歌，由时间、天气、步子、环境声和这里的指纹实时生成一段永不重复的声景。
 */

type ResMode = 'street' | 'run' | 'scape';
type Input = 'mic' | 'demo';

/** 浏览器只在 HTTPS / localhost 下给麦克风；纯 HTTP 的演示站直接默认用模拟街头 */
const MIC_OK = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && (typeof window === 'undefined' || window.isSecureContext !== false);
const sceneOf = (id: DemoScene['id']) => DEMO_SCENES.find((s) => s.id === id) ?? DEMO_SCENES[0]!;

interface SceneMix {
  summary: string;
  moods: string[];
  density: number;
  brightness: number;
  mode: Mode | null;
  space: SpaceId;
  engine: AiEngine;
}

interface Snap {
  eng: EngineState;
  env: EnvSnapshot | null;
  key: ReturnType<typeof chooseTranspose>;
}

const SPACE_BY_CATEGORY: Partial<Record<Category, SpaceId>> = {
  station: 'hall',
  cafe: 'room',
  shop: 'room',
  venue: 'club',
  park: 'open',
  street: 'open',
  campus: 'open',
  landmark: 'open',
};

const tonalityText = (t: Tonality) =>
  t.kind === 'drone' ? `持续的 ${pcName(t.pc)} 音（嗡鸣）` : t.kind === 'key' ? `${keyName(t.key)} 的音乐` : '';

export function ResonanceScreen() {
  const toast = useToast();
  const { coords } = useLocation();
  const { width } = useWindowDimensions();
  const vizSize = Math.min(340, width - 36);

  const [songId, setSongId] = useState(SONGS[0]!.id);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [input, setInput] = useState<Input>(MIC_OK ? 'mic' : 'demo');
  const [demoId, setDemoId] = useState<DemoScene['id']>('walk');
  const [usingDemo, setUsingDemo] = useState(false);
  const [beatOn, setBeatOn] = useState(true);
  const [keyOn, setKeyOn] = useState(true);
  const [sceneOn, setSceneOn] = useState(true);
  const [scene, setScene] = useState<SceneMix | null>(null);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [view, setView] = useState<Snap | null>(null);
  const [rec, setRec] = useState<number | null>(null);
  const [clip, setClip] = useState<{ url: string; type: string } | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [print, setPrint] = useState<ResonanceSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<ResMode>('street');
  const [runTarget, setRunTarget] = useState<number | null>(null);
  const [autoPick, setAutoPick] = useState(true);
  const [run, setRun] = useState<Omit<RunView, 'target' | 'autoPick'>>({ cadence: null, sensor: false, guide: null, onBeatRate: null, elapsed: 0, avgCadence: null });
  const [scapeMode, setScapeMode] = useState<ScapeMode>('focus');
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherState, setWeatherState] = useState<'loading' | 'ok' | 'none'>('loading');
  const [hour, setHour] = useState(() => new Date().getHours());

  const engineRef = useRef<ResonanceEngine | null>(null);
  const listenerRef = useRef<EnvListener | null>(null);
  const hitsRef = useRef<number[]>([]);
  const beatOnRef = useRef(beatOn);
  beatOnRef.current = beatOn;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const stepsRef = useRef<boolean[]>([]);
  const runStatsRef = useRef({ since: 0, sum: 0, n: 0, lastPick: 0 });

  const plan = planScape(scapeMode, hour, weather);

  // 我在哪个地点（在打卡范围内的最近一个）
  const posKey = coords ? `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}` : '';
  useEffect(() => {
    if (!coords) return;
    let alive = true;
    api
      .nearby(coords, 400)
      .then(({ places }) => {
        if (!alive) return;
        const here = places.find((p) => (p.distanceM ?? Infinity) <= checkinAllowanceM(p.radiusM)) ?? null;
        setPlace(here);
        if (here) api.resonance(here.id).then((r) => alive && setPrint(r.resonance)).catch(() => {});
        else setPrint(null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey]);

  // 入景：把场景映射到混音（声景模式由声景自己决定混音）
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || mode === 'scape') return;
    const fallbackSpace = (place?.category && SPACE_BY_CATEGORY[place.category]) || 'open';
    if (sceneOn && scene) {
      eng.setDensity(scene.density);
      eng.setBrightness(scene.brightness);
      eng.setSpace(scene.space);
    } else {
      eng.setDensity(0.8);
      eng.setBrightness(0.75);
      eng.setSpace(sceneOn ? fallbackSpace : 'dry');
    }
  }, [scene, sceneOn, place, running, mode]);

  useEffect(() => {
    if (mode !== 'scape') engineRef.current?.setSong(songId);
  }, [songId, mode]);

  // 声景：进入 / 更新 / 退出
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !running) return;
    if (mode === 'scape') eng.setScape(plan);
    else if (eng.scape) eng.setScape(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, mode, scapeMode, weather, hour]);

  // 天气：进入声景时取一次
  useEffect(() => {
    if (mode !== 'scape' || !coords || weatherState === 'ok') return;
    let alive = true;
    setWeatherState('loading');
    void fetchWeather(coords.lat, coords.lng).then((w) => {
      if (!alive) return;
      setWeather(w);
      setWeatherState(w ? 'ok' : 'none');
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, posKey]);

  // 时段每分钟更新一次
  useEffect(() => {
    const iv = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => clearInterval(iv);
  }, []);

  // 切到跑步时重新计时
  useEffect(() => {
    stepsRef.current = [];
    runStatsRef.current = { since: performance.now(), sum: 0, n: 0, lastPick: 0 };
  }, [mode, running]);

  // 控制回路：每 200 ms 把环境分析结果交给引擎
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      const eng = engineRef.current;
      if (!eng) return;
      const lis = listenerRef.current;
      if (lis) {
        lis.beatSource = mode === 'street' ? 'auto' : 'motion';
        lis.motionPref = mode === 'run' ? 165 : 112;
      }
      const env = lis?.snapshot() ?? null;
      const lockTo = (b: NonNullable<EnvSnapshot['beat']>) =>
        eng.setLock({ period: b.period, beat: b.beat, ratio: fitTempo(b.bpm, eng.song.bpm).ratio });

      if (mode === 'run') {
        const cad = env?.cadence ?? null;
        const stats = runStatsRef.current;
        const now = performance.now();
        // 自动挑歌：按步频（没有传感器时按目标），8 秒内不重复换
        const basis = cad ?? runTarget;
        if (autoPick && basis && now - stats.lastPick > 8000) {
          const best = pickSongForCadence(basis, SONGS);
          if (best.id !== eng.song.id) {
            stats.lastPick = now;
            setSongId(best.id);
          }
        }
        let guide: RunView['guide'] = null;
        if (cad && env?.beat) {
          stats.sum += cad;
          stats.n++;
          guide = guideTempo(cad, runTarget);
          if (guide.arrived) lockTo(env.beat);
          else {
            eng.setLock(null);
            eng.setFreeTempo(fitTempo(guide.tempo, eng.song.bpm).bpm);
          }
        } else {
          eng.setLock(null);
          eng.setFreeTempo(runTarget ? fitTempo(runTarget, eng.song.bpm).bpm : eng.song.bpm);
        }
        setRun({
          cadence: cad,
          sensor: !!env?.motionLive,
          guide,
          onBeatRate: onBeatRate(stepsRef.current),
          elapsed: (now - stats.since) / 1000,
          avgCadence: stats.n ? stats.sum / stats.n : null,
        });
      } else if (mode === 'scape') {
        // 散步声景跟着步子走；其他声景按自己的慢速
        if (scapeMode === 'walk' && env?.beat) lockTo(env.beat);
        else eng.setLock(null);
      } else if (beatOn && env?.beat) {
        lockTo(env.beat);
      } else {
        eng.setLock(null);
      }

      let keyMode: Mode = (mode === 'street' && sceneOn && scene?.mode) || eng.song.key.mode;
      let semis = 0;
      let key: Snap['key'] = null;
      // 声景：环境没有明显的音高时，用这里的共鸣指纹决定根音
      let tonality: Tonality | null = env && env.tonality.kind !== 'none' ? env.tonality : null;
      if (!tonality && mode === 'scape' && print?.tonic !== null && print?.tonic !== undefined && print.mode) {
        tonality = print.mode === 'drone' ? { kind: 'drone', pc: print.tonic, strength: 1 } : { kind: 'key', key: { tonic: print.tonic, mode: print.mode }, strength: 1 };
      }
      if (keyOn && tonality) {
        key = chooseTranspose({ tonic: eng.song.key.tonic, mode: keyMode }, tonality);
        if (key) {
          semis = key.semis;
          keyMode = key.mode;
        }
      }
      if (semis !== eng.transpose || keyMode !== eng.mode) eng.setTonality(semis, keyMode);
      setView({ eng: eng.state(), env, key });
    }, 200);
    return () => clearInterval(iv);
  }, [running, beatOn, keyOn, sceneOn, scene, mode, runTarget, autoPick, scapeMode, print]);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    listenerRef.current?.stop();
    void engineRef.current?.ctx.close().catch(() => {});
    engineRef.current = null;
    listenerRef.current = null;
    setRunning(false);
    setView(null);
  }, []);

  useEffect(() => stop, [stop]);

  // 从欢迎页点了「30 秒听见共鸣」：进来就自动开始，用模拟街头
  useEffect(() => {
    if (!consumeAutoDemo()) return;
    setInput('demo');
    void start(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async (forceDemo = false) => {
    setStarting(true);
    setMicError(null);
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      await ctx.resume();
      const eng = new ResonanceEngine(ctx);
      eng.setSong(songId);
      if (mode === 'scape') eng.setScape(plan);
      engineRef.current = eng;
      const lis = new EnvListener(ctx);
      lis.onHit = (t) => {
        hitsRef.current.push(t);
        if (beatOnRef.current) eng.duck();
      };
      try {
        // 模拟街头：评委不在街上、没有麦克风权限、站点不是 HTTPS 时，也能看见「对拍 → 定调」
        let demo = forceDemo || input === 'demo';
        if (!demo) {
          try {
            await lis.start();
          } catch (err) {
            if (modeRef.current === 'run') throw err;
            demo = true;
            setMicError(
              MIC_OK
                ? '没有麦克风权限，已改用「模拟街头」：一段合成的脚步和嗡鸣，照样能看到歌怎么跟上它。'
                : '当前页面不是 HTTPS，浏览器不允许使用麦克风，已改用「模拟街头」。换成 HTTPS 地址即可听你身边的真实世界。',
            );
          }
        }
        if (demo) await lis.startDemo(sceneOf(demoId));
        setUsingDemo(demo);
        eng.attachMic(lis.source);
        listenerRef.current = lis;
        if (!demo) void lis.startMotion();
        lis.onStep = (t) => {
          if (modeRef.current !== 'run' || !eng.playing) return;
          const beats = eng.beats.filter((b) => b <= t);
          const last = beats[beats.length - 1];
          if (last === undefined) return;
          stepsRef.current.push(onBeat(t, last + eng.latency, 60 / eng.bpm, eng.lock?.ratio ?? 1));
          if (stepsRef.current.length > 200) stepsRef.current.splice(0, 100);
        };
      } catch {
        setMicError('没有麦克风权限：歌会照常播放，但听不到周围，无法对拍和定调。');
      }
      eng.start();
      setRunning(true);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '无法启动音频', 'error');
    } finally {
      setStarting(false);
    }
  };

  const readScene = async (withPhoto: boolean) => {
    if (!coords) return toast.show('需要定位才能读懂这里', 'error');
    setSceneBusy(true);
    try {
      const photo = withPhoto ? await pickScenePhoto('camera') : null;
      if (withPhoto && !photo) return;
      const res = await api.scene({
        lat: coords.lat,
        lng: coords.lng,
        ...(photo ? { image: photo.base64, ...(photo.colorHint ? { colorHint: photo.colorHint } : {}) } : {}),
      });
      const s = res.scene;
      const cat = res.place?.category ?? place?.category ?? null;
      const space: SpaceId = s.tags.some((t) => /隧道|地下|通道|地铁/.test(t)) ? 'hall' : (cat && SPACE_BY_CATEGORY[cat]) || 'open';
      setScene({
        summary: s.summary,
        moods: s.moods,
        density: 0.3 + 0.7 * s.energy,
        brightness: photo?.colorHint?.brightness ?? 0.35 + 0.55 * s.valence,
        mode: s.valence < 0.42 ? 'minor' : s.valence > 0.6 ? 'major' : null,
        space,
        engine: res.engine,
      });
      setSceneOn(true);
    } catch (err) {
      toast.show(err instanceof PickError || err instanceof Error ? err.message : '读取失败', 'error');
    } finally {
      setSceneBusy(false);
    }
  };

  const clipSeconds = mode === 'street' ? 15 : 10;
  const clipTitle = mode === 'street' ? '共鸣片段' : mode === 'run' ? '跑步片段' : '声景片段';

  const record = async () => {
    const eng = engineRef.current;
    if (!eng) return;
    setClip(null);
    setRec(0);
    try {
      const blob = await eng.record(clipSeconds, setRec);
      setClip({ url: URL.createObjectURL(blob), type: blob.type });
      toast.show(`${clipTitle}录好了`);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '录制失败', 'error');
    } finally {
      setRec(null);
    }
  };

  const saveClip = () => {
    if (!clip) return;
    const ext = clip.type.includes('ogg') ? 'ogg' : clip.type.includes('mp4') ? 'm4a' : 'webm';
    const a = document.createElement('a');
    a.href = clip.url;
    // 文件名用 ASCII：部分浏览器会丢弃非 ASCII 的下载文件名
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    a.download = `musichere-${mode === 'street' ? 'resonance' : mode}-${stamp}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const savePrint = async () => {
    const env = view?.env;
    if (!place || !coords || !env?.beat) return;
    setSaving(true);
    try {
      const t = env.tonality;
      const { resonance } = await api.addResonance(place.id, {
        lat: coords.lat,
        lng: coords.lng,
        bpm: Math.round(env.beat.bpm * 10) / 10,
        confidence: Math.round(env.beat.confidence * 100) / 100,
        source: env.beat.source,
        ...(t.kind === 'drone' ? { tonic: t.pc, mode: 'drone' as const } : t.kind === 'key' ? { tonic: t.key.tonic, mode: t.key.mode } : {}),
      });
      setPrint(resonance);
      toast.show(`已把这里的拍子留在「${place.name}」`);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  /** 用地点的共鸣指纹预调：还没听清环境时，先按这里平时的拍子和调起播 */
  const usePrint = () => {
    const eng = engineRef.current;
    if (!eng || !print?.bpm) return;
    eng.setFreeTempo(fitTempo(print.bpm, eng.song.bpm).bpm);
    if (print.tonic !== null && print.mode) {
      const t: Tonality = print.mode === 'drone' ? { kind: 'drone', pc: print.tonic, strength: 1 } : { kind: 'key', key: { tonic: print.tonic, mode: print.mode }, strength: 1 };
      const c = chooseTranspose(eng.song.key, t);
      if (c) eng.setTonality(c.semis, c.mode);
    }
    toast.show(`已按「${place?.name}」的共鸣指纹预调`);
  };

  const eng = view?.eng;
  const env = view?.env;
  const beat = env?.beat;
  const song = SONGS.find((s) => s.id === songId)!;

  const beatStatus = !running
    ? '开始后，手机会听周围的节奏'
    : !listenerRef.current
      ? '没有麦克风，无法对拍'
      : env?.warming
        ? '正在听周围的节奏…'
        : beat
          ? `${beat.source === 'motion' ? '你的脚步' : '环境'} ${beat.bpm.toFixed(1)} BPM → 歌曲 ${eng ? Math.round(eng.bpm) : '—'} BPM`
          : '周围暂时没有稳定的节奏，歌曲按自己的速度走';

  const keyStatus = !running
    ? '开始后，手机会听周围有没有一个「调」'
    : eng && env && env.tonality.kind !== 'none' && view?.key
      ? `${tonalityText(env.tonality)} → ${mode === 'scape' ? '声景' : '歌曲'} ${view.key.semis >= 0 ? '+' : ''}${view.key.semis} 半音，${keyName(eng.key)}${view.key.role === '同调' ? '' : `（${pcName(env.tonality.kind === 'drone' ? env.tonality.pc : 0)} 是新调的${view.key.role}）`}`
      : mode === 'scape' && print?.tonic !== null && print?.tonic !== undefined && view?.key
        ? `周围没有明显的音高 → 用这里的共鸣指纹定根音（${keyName(eng!.key)}）`
        : `周围没有明显的音高，${mode === 'scape' ? '声景' : '歌曲'}保持原调`;

  const locked = !!eng?.locked;
  const keyLocked = !!(keyOn && view?.key && running);
  const bestForRun = mode === 'run' && (run.cadence ?? runTarget) ? pickSongForCadence((run.cadence ?? runTarget)!, SONGS).id : null;
  const scapeEnv =
    env && env.tonality.kind !== 'none' && eng
      ? `${tonalityText(env.tonality)} → 声景的根音跟着它（${keyName(eng.key)}）`
      : running
        ? '周围没有明显的音高'
        : '开始后会听周围有没有嗡鸣';
  const scapeSteps = scapeMode !== 'walk' ? '这个模式不跟步子' : env?.cadence ? `${Math.round(env.cadence)} 步 / 分 → 脉冲跟着走` : env?.motionLive ? '静止' : '没有检测到加速度计';
  const printText = place && print?.count ? `${place.name} · ${Math.round(print.bpm!)} BPM${print.tonic !== null ? ` · ${pcName(print.tonic)}${print.mode === 'drone' ? ' 嗡鸣' : print.mode === 'minor' ? ' 小调' : ' 大调'}` : ''}` : null;
  const now = new Date();

  return (
    <Screen testID="screen-resonance" glow={colors.violet}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Txt v="display">共鸣</Txt>
          <AIBadge label="实验" />
        </View>
        <Txt v="sub">
          {mode === 'street'
            ? '降噪把世界关在外面，通透把世界放进来——共鸣让世界成为你这首歌的一部分：跟着它的节奏，落在它的调上。'
            : mode === 'run'
              ? '按你的步频挑歌、锁在你的脚步上；想跑得更快，音乐会先快一点点，带着你提上去。'
              : '不放歌：时间、天气、你的步子、身边的嗡鸣，实时生成一段只属于此刻的声景。'}
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pill label="建议戴耳机" icon="headset" color={colors.sky} />
          <Pill label="环境声只在本机分析，不上传" icon="lock-closed" color={colors.mint} />
        </View>
      </View>

      <Segmented<ResMode>
        value={mode}
        onChange={setMode}
        options={[
          { key: 'street', label: '街头', testID: 'res-mode-street' },
          { key: 'run', label: '跑步', testID: 'res-mode-run' },
          { key: 'scape', label: '声景', testID: 'res-mode-scape' },
        ]}
      />

      {mode !== 'run' ? (
        <Card style={{ gap: 10 }} testID="res-input">
          <View style={styles.rowBetween}>
            <Txt v="title">世界从哪来</Txt>
            {running && usingDemo ? <Pill label="模拟街头" icon="flask" color={colors.sky} /> : null}
          </View>
          {!running ? (
            <Segmented<Input>
              value={input}
              onChange={setInput}
              options={[
                { key: 'mic', label: '真实麦克风', testID: 'res-input-mic' },
                { key: 'demo', label: '模拟街头', testID: 'res-input-demo' },
              ]}
            />
          ) : null}
          {(running ? usingDemo : input === 'demo') ? (
            <View style={{ gap: 8 }}>
              <Segmented<DemoScene['id']>
                value={demoId}
                onChange={(id) => {
                  setDemoId(id);
                  listenerRef.current?.setDemoScene(sceneOf(id));
                }}
                options={DEMO_SCENES.map((s) => ({ key: s.id, label: s.label, testID: `res-scene-${s.id}` }))}
              />
              <Txt v="caption">
                {sceneOf(demoId).hint}。{running ? '切换场景，看歌多久重新跟上。' : '不需要麦克风权限，也不用真的走到街上。'}
              </Txt>
            </View>
          ) : (
            <Txt v="caption">用手机麦克风听身边的真实世界；声音只在本机分析。{MIC_OK ? '' : '（当前不是 HTTPS，浏览器不会给麦克风）'}</Txt>
          )}
        </Card>
      ) : null}

      <View style={styles.vizCard}>
        <ResonanceViz engine={engineRef} listener={listenerRef} hits={hitsRef} size={vizSize} />
        <View style={styles.legend}>
          <Legend color={colors.violet} label={mode === 'street' ? '世界的拍子' : '你的步子'} />
          <Legend color={colors.lime} label="歌的拍子" />
          <Legend color={colors.sky} label="环境重音" />
        </View>
        {running && eng ? (
          <Text style={styles.readout} testID="res-readout">
            {locked ? `已对拍 · 相位差 ${Math.abs(eng.phaseErrorMs)} ms` : env?.warming ? '正在听周围…' : '自由播放'}
            {` · ${keyName(eng.key)} · 延迟补偿 ${eng.latencyMs} ms`}
          </Text>
        ) : null}
        {running ? (
          <Button label="停止" icon="stop" variant="subtle" onPress={stop} testID="res-stop" style={{ alignSelf: 'stretch' }} />
        ) : (
          <Button
            label={mode === 'street' ? '开始共鸣' : mode === 'run' ? '开始跑' : '开始声景'}
            icon={mode === 'run' ? 'walk' : mode === 'scape' ? 'leaf' : 'pulse'}
            variant="aurora"
            size="lg"
            onPress={() => void start()}
            loading={starting}
            testID="res-start"
            style={{ alignSelf: 'stretch' }}
          />
        )}
        {running && mode === 'street' ? (
          <Button
            label={beatOn && keyOn ? '听听没有共鸣的样子' : '打开共鸣'}
            icon={beatOn && keyOn ? 'eye-off' : 'pulse'}
            variant="subtle"
            onPress={() => {
              const next = !(beatOn && keyOn);
              setBeatOn(next);
              setKeyOn(next);
            }}
            testID="res-ab"
            style={{ alignSelf: 'stretch' }}
          />
        ) : null}
        {micError ? <Txt v="caption" style={{ color: colors.sunset }}>{micError}</Txt> : null}
      </View>

      {mode === 'run' ? (
        <RunPanel
          view={{ ...run, target: runTarget, autoPick }}
          running={running}
          onTarget={setRunTarget}
          onAutoPick={setAutoPick}
        />
      ) : null}

      {mode === 'scape' ? (
        <ScapePanel
          mode={scapeMode}
          onMode={setScapeMode}
          plan={plan}
          inputs={{
            time: `${hourLabel(hour)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
            weather,
            weatherState,
            env: scapeEnv,
            steps: scapeSteps,
            place: printText,
          }}
        />
      ) : null}

      {mode !== 'scape' ? <Txt v="label">{mode === 'run' ? '曲子（自动挑最合拍的，也可以自己选）' : '选一首原创曲'}</Txt> : null}
      {mode !== 'scape' ? (
      <View style={styles.songs}>
        {SONGS.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => {
              setSongId(s.id);
              if (mode === 'run') setAutoPick(false);
            }}
            style={[styles.song, s.id === songId && styles.songOn]}
            testID={`song-${s.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: s.id === songId }}
          >
            <Text style={[styles.songTitle, s.id === songId && { color: colors.ink }]}>{s.title}</Text>
            <Text style={[styles.songMeta, s.id === songId && { color: 'rgba(7,8,12,0.7)' }]}>{s.vibe}</Text>
            <Text style={[styles.songMeta, s.id === songId && { color: 'rgba(7,8,12,0.7)' }]}>
              {s.bpm} BPM · {keyName(s.key)}
            </Text>
            {bestForRun === s.id ? (
              <Text style={[styles.best, s.id === songId && { color: colors.ink }]} testID="run-best">
                ★ 最合拍
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
      ) : null}

      {mode === 'street' ? (
      <Feature
        icon="pulse"
        title="对拍"
        on={beatOn}
        onToggle={setBeatOn}
        status={beatOn ? beatStatus : '关闭：歌曲按自己的速度播放'}
        active={locked}
        activeLabel="已对拍"
        testID="res-beat"
        detail={
          beat && beatOn && running ? (
            <View style={{ gap: 6 }}>
              <Meter value={beat.confidence} label={`把握 ${Math.round(beat.confidence * 100)}%`} />
              <Txt v="caption">脚步、转向灯、车轮、街头艺人的鼓……歌曲的速度会平滑地滑过去，每一拍都向世界的拍点靠拢；环境里的重音还会轻轻「推」一下音乐。</Txt>
            </View>
          ) : null
        }
      />
      ) : null}
      <Feature
        icon="musical-notes"
        title="定调"
        on={keyOn}
        onToggle={setKeyOn}
        status={keyOn ? keyStatus : `关闭：保持原调 ${mode === 'scape' ? '' : keyName(song.key)}`}
        active={keyLocked}
        activeLabel="已定调"
        testID="res-key"
      />
      {mode === 'street' ? (
      <Feature
        icon="camera"
        title="入景"
        on={sceneOn}
        onToggle={setSceneOn}
        status={
          scene && sceneOn
            ? `${scene.summary} → ${SPACES[scene.space].name}混响 · 明暗 ${Math.round(scene.brightness * 100)}% · 编配${scene.density > 0.7 ? '饱满' : scene.density > 0.45 ? '适中' : '稀疏'}${scene.mode ? ` · ${scene.mode === 'major' ? '大调' : '小调'}` : ''}`
            : sceneOn
              ? '拍一下眼前，AI 会按画面调整混响、明暗、编配和大小调'
              : '关闭：干声、标准混音'
        }
        active={!!scene && sceneOn}
        activeLabel={scene?.engine.kind === 'llm' ? scene.engine.label : 'AI 入景'}
        testID="res-scene"
        detail={
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="拍一下" icon="camera" variant="aurora" size="sm" onPress={() => void readScene(true)} loading={sceneBusy} style={{ flex: 1 }} testID="res-scene-photo" />
            <Button label="不拍，直接读" icon="sparkles" variant="subtle" size="sm" onPress={() => void readScene(false)} disabled={sceneBusy} style={{ flex: 1 }} testID="res-scene-read" />
          </View>
        }
      />
      ) : null}

      <Card style={{ gap: 12 }} testID="res-clip">
        <View style={styles.rowBetween}>
          <Txt v="title">{clipTitle}</Txt>
          {rec !== null ? <Pill label={`录制中 ${Math.round(rec * clipSeconds)}s / ${clipSeconds}s`} icon="radio-button-on" color={colors.red} /> : null}
        </View>
        <Txt v="sub">把此刻「世界 + {mode === 'scape' ? '声景' : '你的歌'}」录成 {clipSeconds} 秒：环境声和音乐按耳朵里听到的时刻对齐。</Txt>
        {clip ? (
          <View style={{ gap: 10 }}>
            <audio src={clip.url} controls style={{ width: '100%' }} data-testid="res-audio" />
            <Button label="保存片段" icon="download" variant="subtle" size="sm" onPress={saveClip} testID="res-download" />
          </View>
        ) : null}
        <Button label={rec !== null ? '录制中…' : `录 ${clipSeconds} 秒`} icon="radio-button-on" variant="subtle" onPress={() => void record()} disabled={!running || rec !== null} testID="res-record" />
      </Card>

      {place && mode === 'street' ? (
        <View style={styles.printCard} testID="res-print">
          <LinearGradient colors={['rgba(183,243,107,0.14)', 'rgba(62,230,193,0.04)']} style={StyleSheet.absoluteFill} />
          <View style={styles.rowBetween}>
            <Txt v="title">{place.name} 的共鸣指纹</Txt>
            <Ionicons name="finger-print" size={20} color={colors.lime} />
          </View>
          {print && print.count > 0 ? (
            <Text style={styles.printBig} testID="res-print-value">
              {Math.round(print.bpm!)} BPM{print.tonic !== null ? ` · ${pcName(print.tonic)}${print.mode === 'drone' ? ' 嗡鸣' : print.mode === 'minor' ? ' 小调' : ' 大调'}` : ''}
            </Text>
          ) : (
            <Txt v="sub">这里还没有人留下过拍子。</Txt>
          )}
          {print && print.count > 0 ? <Txt v="caption">{print.contributors} 人在现场贡献 · 只存数字，不存声音</Txt> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="按它预调" icon="options" variant="subtle" size="sm" onPress={usePrint} disabled={!running || !print?.bpm} style={{ flex: 1 }} testID="res-use-print" />
            <Button label="留下此刻的拍子" icon="finger-print" size="sm" onPress={() => void savePrint()} loading={saving} disabled={!running || !beat} style={{ flex: 1 }} testID="res-save-print" />
          </View>
        </View>
      ) : null}

      <Txt v="caption" style={{ textAlign: 'center' }}>
        Demo 使用实时合成的原创曲目，速度与调可以无损变化；接入 QQ 音乐后，正式曲库将以分轨 + 实时变速变调的方式支持共鸣。
      </Txt>
    </Screen>
  );
}

function Feature({
  icon,
  title,
  on,
  onToggle,
  status,
  active,
  activeLabel,
  detail,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  status: string;
  active: boolean;
  activeLabel: string;
  detail?: React.ReactNode;
  testID: string;
}) {
  return (
    <View style={[styles.feature, active && on && styles.featureOn]} testID={testID}>
      <View style={styles.rowBetween}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[styles.featIcon, active && on && { backgroundColor: colors.lime }]}>
            <Ionicons name={icon} size={18} color={active && on ? colors.ink : colors.text} />
          </View>
          <Text style={styles.featTitle}>{title}</Text>
          {active && on ? <Pill label={activeLabel} icon="checkmark-circle" color={colors.lime} /> : null}
        </View>
        <Switch
          value={on}
          onValueChange={onToggle}
          trackColor={{ false: colors.surface3, true: colors.mint }}
          thumbColor="#fff"
          testID={`${testID}-toggle`}
        />
      </View>
      <Text style={styles.featStatus} testID={`${testID}-status`}>
        {status}
      </Text>
      {on && detail ? detail : null}
    </View>
  );
}

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.meter}>
        <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.round(value * 100)}%`, height: '100%' }} />
      </View>
      <Txt v="caption">{label}</Txt>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color: colors.sub, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  vizCard: {
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  legend: { flexDirection: 'row', gap: 14, flexWrap: 'wrap', justifyContent: 'center' },
  readout: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  songs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  song: {
    width: '47%',
    flexGrow: 1,
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 3,
  },
  songOn: { backgroundColor: colors.lime, borderColor: colors.lime },
  songTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  songMeta: { color: colors.sub, fontSize: 11 },
  feature: {
    gap: 10,
    padding: 14,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  featureOn: { borderColor: 'rgba(183,243,107,0.45)' },
  featIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  featTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  featStatus: { color: colors.sub, fontSize: 13, lineHeight: 19 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  meter: { height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: 'hidden' },
  printCard: {
    gap: 10,
    padding: 16,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(183,243,107,0.35)',
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  printBig: { color: colors.lime, fontSize: 28, fontWeight: '900' },
  best: { color: colors.lime, fontSize: 11, fontWeight: '900', marginTop: 2 },
});
