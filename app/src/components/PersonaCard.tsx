import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import type { Persona } from '../lib/api';
import { colors, moodColor, radius } from '../lib/theme';
import { AIBadge, Pill, Txt } from './ui';

/**
 * 「这里的声音」：AI 写的一句画像 + 情绪构成 + 24 小时热度 + 常被留下的艺人。
 * 统计全部来自真实数据，AI 只负责把它说成人话。
 */
export function PersonaCard({ persona }: { persona: Persona }) {
  const max = Math.max(1, ...persona.hours);
  const peak = persona.peak?.startHour;
  return (
    <View style={styles.card} testID="persona-card">
      <LinearGradient
        colors={['rgba(160,139,255,0.20)', 'rgba(92,200,255,0.06)', 'rgba(0,0,0,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.head}>
        <Text style={styles.label}>这里的声音</Text>
        <AIBadge label={persona.engine.kind === 'llm' ? persona.engine.label : 'AI 画像'} />
      </View>
      <Text style={styles.summary} testID="persona-summary">
        {persona.summary}
      </Text>

      {persona.moods.length > 0 ? (
        <View style={{ gap: 8 }}>
          {persona.moods.map((m) => {
            const c = moodColor[m.mood] ?? colors.sub;
            return (
              <View key={m.mood} style={styles.barRow}>
                <Text style={[styles.barLabel, { color: c }]}>{m.mood}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.max(6, m.share * 100)}%`, backgroundColor: c }]} />
                </View>
                <Text style={styles.barPct}>{Math.round(m.share * 100)}%</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={{ gap: 6 }}>
        <View style={styles.hoursHead}>
          <Text style={styles.small}>24 小时热度</Text>
          {persona.peak ? <Text style={[styles.small, { color: colors.lime }]}>{persona.peak.label} 最热闹</Text> : null}
        </View>
        <View style={styles.hours}>
          {persona.hours.map((n, h) => {
            const inPeak = peak !== undefined && (h === peak || h === (peak + 1) % 24);
            return (
              <View key={h} style={styles.hourCol}>
                <View
                  style={[
                    styles.hourBar,
                    { height: 4 + (n / max) * 40 },
                    n === 0 && { opacity: 0.25 },
                    inPeak && { backgroundColor: colors.lime },
                  ]}
                />
              </View>
            );
          })}
        </View>
        <View style={styles.hoursAxis}>
          {['0', '6', '12', '18', '24'].map((t) => (
            <Text key={t} style={styles.axis}>
              {t}
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.wrap}>
        {persona.keywords.map((k) => (
          <Pill key={k} label={k} color={colors.violet} />
        ))}
        {persona.topArtists.map((a) => (
          <Pill key={a} label={a} icon="person" color={colors.sky} />
        ))}
      </View>
      <Txt v="caption">
        {persona.counts.songs} 首歌 · {persona.counts.live} 次现场 · {persona.counts.visitors} 人来过 · {persona.counts.comments} 条留言
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(160,139,255,0.28)',
    backgroundColor: colors.surface,
    padding: 18,
    gap: 16,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: colors.sub, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  summary: { color: colors.text, fontSize: 18, lineHeight: 28, fontWeight: '700' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 34, fontSize: 12, fontWeight: '900' },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surface3, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  barPct: { width: 36, textAlign: 'right', color: colors.sub, fontSize: 12, fontWeight: '700' },
  hoursHead: { flexDirection: 'row', justifyContent: 'space-between' },
  small: { color: colors.sub, fontSize: 12, fontWeight: '700' },
  hours: { flexDirection: 'row', alignItems: 'flex-end', height: 46, gap: 2 },
  hourCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  hourBar: { width: '100%', borderRadius: 2, backgroundColor: colors.violet },
  hoursAxis: { flexDirection: 'row', justifyContent: 'space-between' },
  axis: { color: colors.faint, fontSize: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});

