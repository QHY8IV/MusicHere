import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { SCAPE_MODES, type ScapeMode, type ScapePlan, type Weather } from '../lib/resonance/scape';
import { colors, radius } from '../lib/theme';
import { Chip, Pill, Txt } from './ui';

/** 跑步与声景两个模式的面板（只负责展示，状态在 Resonance.web.tsx） */

export const RUN_TARGETS = [null, 160, 170, 180] as const;

export interface RunView {
  cadence: number | null;
  sensor: boolean;
  target: number | null;
  /** 节拍引导的状态 */
  guide: { arrived: boolean; lead: number; tempo: number } | null;
  onBeatRate: number | null;
  elapsed: number;
  avgCadence: number | null;
  autoPick: boolean;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function RunPanel({
  view,
  running,
  onTarget,
  onAutoPick,
}: {
  view: RunView;
  running: boolean;
  onTarget: (t: number | null) => void;
  onAutoPick: (v: boolean) => void;
}) {
  const { cadence, sensor, target, guide } = view;
  const status = !running
    ? '开始后，手机的加速度计会数你的步子'
    : cadence && guide
      ? guide.arrived
        ? `已锁到你的脚步：每一步都落在拍子上${target ? `（目标 ${target} 已达到）` : ''}`
        : `节拍引导：音乐比你的步子${guide.lead > 0 ? '快' : '慢'} ${Math.abs(Math.round(guide.lead * 100))}%，带你从 ${Math.round(cadence)} ${guide.lead > 0 ? '提到' : '降到'} ${target}`
      : sensor
        ? '正在数你的步子…'
        : target
          ? `没有检测到加速度计：按 ${target} 步 / 分 播放（节拍器模式）`
          : '没有检测到加速度计：用手机打开并开始跑；或者选一个目标步频，让音乐当节拍器';

  return (
    <View style={styles.panel} testID="run-panel">
      <LinearGradient colors={['rgba(183,243,107,0.16)', 'rgba(62,230,193,0.04)']} style={StyleSheet.absoluteFill} />
      <View style={styles.rowBetween}>
        <View>
          <Txt v="label">你的步频</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={styles.big} testID="run-cadence">
              {cadence ? Math.round(cadence) : '—'}
            </Text>
            <Text style={styles.unit}>步 / 分</Text>
          </View>
        </View>
        <Ionicons name="walk" size={44} color={colors.lime} />
      </View>

      <View style={{ gap: 8 }}>
        <Txt v="label">目标步频</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {RUN_TARGETS.map((t) => (
            <Chip
              key={String(t)}
              label={t === null ? '跟随我' : `${t}`}
              selected={target === t}
              onPress={() => onTarget(t)}
              testID={`run-target-${t ?? 'follow'}`}
            />
          ))}
        </View>
      </View>

      <Text style={styles.status} testID="run-guide">
        {status}
      </Text>

      <View style={styles.stats}>
        <Stat label="时长" value={mmss(view.elapsed)} />
        <Stat label="平均步频" value={view.avgCadence ? `${Math.round(view.avgCadence)}` : '—'} />
        <Stat label="合拍率" value={view.onBeatRate === null ? '—' : `${Math.round(view.onBeatRate * 100)}%`} testID="run-onbeat" />
      </View>

      <View style={styles.rowBetween}>
        <Txt v="sub">自动挑最合拍的曲子</Txt>
        <Switch value={view.autoPick} onValueChange={onAutoPick} trackColor={{ false: colors.surface3, true: colors.mint }} thumbColor="#fff" testID="run-autopick" />
      </View>
      <Txt v="caption">
        不只跟随：设了目标步频，音乐会比你快一点点（最多 3%），你会不自觉地跟上去；到了目标就锁在你的脚步上。
      </Txt>
    </View>
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

export interface ScapeInputs {
  time: string;
  weather: Weather | null;
  weatherState: 'loading' | 'ok' | 'none';
  env: string;
  steps: string;
  place: string | null;
}

export function ScapePanel({
  mode,
  onMode,
  inputs,
  plan,
}: {
  mode: ScapeMode;
  onMode: (m: ScapeMode) => void;
  inputs: ScapeInputs;
  plan: ScapePlan;
}) {
  const w = inputs.weather;
  const weatherText =
    inputs.weatherState === 'loading'
      ? '获取中…'
      : w
        ? `${w.label} ${Math.round(w.temp)}°C${w.wind > 0.05 ? ` · 风 ${Math.round(w.wind * 40)} km/h` : ''}`
        : '没有天气数据（只用时间与环境）';
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.panel} testID="scape-panel">
        <LinearGradient colors={['rgba(160,139,255,0.20)', 'rgba(92,200,255,0.05)']} style={StyleSheet.absoluteFill} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(Object.keys(SCAPE_MODES) as ScapeMode[]).map((m) => (
            <Chip key={m} label={SCAPE_MODES[m].label} selected={mode === m} onPress={() => onMode(m)} testID={`scape-${m}`} />
          ))}
        </View>
        <Txt v="sub">{SCAPE_MODES[mode].hint}</Txt>
        <Txt v="caption">不播放任何一首歌：声景由下面这些输入实时生成，每一刻都不重复。</Txt>
      </View>

      <View style={styles.panel} testID="scape-inputs">
        <Txt v="title">此刻的输入</Txt>
        <Row icon="time" label="时间" value={inputs.time} />
        <Row icon="rainy" label="天气" value={weatherText} testID="scape-weather" />
        <Row icon="ear" label="环境声" value={inputs.env} />
        <Row icon="walk" label="你的步子" value={inputs.steps} />
        {inputs.place ? <Row icon="finger-print" label="这里" value={inputs.place} /> : null}
      </View>

      <View style={styles.panel} testID="scape-why">
        <Txt v="title">于是声景是这样的</Txt>
        {plan.why.map((x) => (
          <View key={x} style={{ flexDirection: 'row', gap: 8 }}>
            <Text style={{ color: colors.violet }}>•</Text>
            <Txt v="sub" style={{ flex: 1 }}>
              {x}
            </Txt>
          </View>
        ))}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pill label={plan.pulse > 0 ? '有轻柔的脉冲' : '没有节拍'} icon="pulse" color={colors.sky} />
          {plan.rain > 0.2 ? <Pill label="雨声层" icon="rainy" color={colors.sky} /> : null}
          {plan.wind > 0.3 ? <Pill label="风声层" icon="leaf" color={colors.mint} /> : null}
          {plan.breath ? <Pill label={`呼吸引导 ${plan.breath} 秒一次`} icon="heart" color={colors.pink} /> : null}
        </View>
        <Txt v="caption">天气数据：Open-Meteo.com（CC BY 4.0）</Txt>
      </View>
    </View>
  );
}

function Row({ icon, label, value, testID }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string; testID?: string }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={16} color={colors.violet} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} testID={testID} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 12,
    padding: 16,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  big: { color: colors.lime, fontSize: 52, fontWeight: '900', letterSpacing: -1 },
  unit: { color: colors.sub, fontSize: 14, fontWeight: '700' },
  status: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  stats: { flexDirection: 'row', paddingVertical: 10, borderRadius: radius.lg, backgroundColor: 'rgba(7,8,12,0.35)' },
  statValue: { color: colors.text, fontSize: 20, fontWeight: '900' },
  statLabel: { color: colors.sub, fontSize: 11 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { color: colors.sub, fontSize: 13, width: 56 },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
});
