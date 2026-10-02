import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Place } from '../lib/api';
import { CATEGORY_LABEL, KIND_LABEL, formatDistance } from '../lib/format';
import { colors, radius } from '../lib/theme';
import { Artwork } from './Art';
import { PlaceCover } from './PlaceCover';
import { Pill } from './ui';

/** 地点卡片：封面做底，地点名压在图上；下方是这里最受欢迎的一首歌。 */
export function PlaceCard({ place, onPress, compact = false }: { place: Place; onPress: () => void; compact?: boolean }) {
  const inside = place.distanceM !== null && place.distanceM <= place.radiusM;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={place.name}
      testID="place-card"
      style={({ pressed }) => [styles.card, compact && { width: 220 }, pressed && { transform: [{ scale: 0.985 }] }]}
    >
      <PlaceCover place={place} height={compact ? 150 : 176}>
        <View style={styles.pills}>
          {inside ? <Pill label="你在这里" icon="navigate" color={colors.lime} solid /> : null}
          {place.distanceM !== null && !inside ? <Pill label={formatDistance(place.distanceM)} icon="walk" color="#ffffff" /> : null}
          {place.category && !compact ? <Pill label={CATEGORY_LABEL[place.category]} color="#ffffff" /> : null}
        </View>
        <Text style={[styles.name, compact && { fontSize: 18 }]} numberOfLines={1}>
          {place.name}
        </Text>
      </PlaceCover>
      <View style={styles.body}>
        {place.topSong ? (
          <View style={styles.top}>
            <Artwork title={place.topSong.title} artist={place.topSong.artist} size={34} />
            <View style={{ flex: 1 }}>
              <Text style={styles.song} numberOfLines={1}>
                {place.topSong.title}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {KIND_LABEL[place.topSong.kind as 'vibe']} · {place.topSong.artist}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={styles.meta}>还没有人分享歌曲，来做第一个</Text>
        )}
        <View style={styles.stats}>
          <Stat icon="musical-notes" n={place.songCount} />
          <Stat icon="footsteps" n={place.visitorCount} />
          <Stat icon="chatbubble" n={place.commentCount} />
          {!compact ? <Ionicons name="chevron-forward" size={16} color={colors.faint} style={{ marginLeft: 'auto' }} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

function Stat({ icon, n }: { icon: React.ComponentProps<typeof Ionicons>['name']; n: number }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={12} color={colors.faint} />
      <Text style={styles.statText}>{n}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  name: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: -0.2 },
  body: { padding: 14, gap: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  song: { color: colors.text, fontSize: 14, fontWeight: '800' },
  meta: { color: colors.sub, fontSize: 12 },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { color: colors.sub, fontSize: 12, fontWeight: '700' },
});
