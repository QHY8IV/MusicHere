import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { qqMusicUrl, type Recommendation } from '../lib/api';
import { formatDistance } from '../lib/format';
import { artPalette, colors, radius } from '../lib/theme';
import { Vinyl } from './Art';
import { Button, IconButton, KindBadge, MoodChip } from './ui';

/** 首页的「此刻推荐」：一张转动的唱片，配上为什么是这首。 */
export function NowPlaying({
  rec,
  index,
  total,
  onNext,
  onLike,
  onPressPlace,
}: {
  rec: Recommendation;
  index: number;
  total: number;
  onNext: () => void;
  onLike: () => void;
  onPressPlace: () => void;
}) {
  const { song } = rec.placeSong;
  const [a, , c] = artPalette(`${song.title}|${song.artist}`);
  const liked = rec.placeSong.myVote === 1;
  return (
    <View style={styles.card} testID="now-playing">
      <LinearGradient
        colors={[`${a}40`, `${c}26`, 'rgba(18,21,29,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.top}>
        <Vinyl title={song.title} artist={song.artist} size={128} />
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={styles.kicker}>
            此刻推荐 · {index + 1}/{total}
          </Text>
          <Text style={styles.title} numberOfLines={2} testID="now-title">
            {song.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {song.artist}
          </Text>
          <View style={styles.wrap}>
            <KindBadge kind={rec.placeSong.kind} />
            {rec.moods.slice(0, 2).map((m) => (
              <MoodChip key={m} mood={m} size="sm" />
            ))}
          </View>
        </View>
      </View>

      <View style={styles.reason}>
        <Ionicons name="sparkles" size={14} color={colors.violet} />
        <Text style={styles.reasonText} testID="now-reason">
          {rec.reason}
        </Text>
      </View>

      <Pressable onPress={onPressPlace} style={styles.placeRow} accessibilityRole="link">
        <Ionicons name="location" size={13} color={colors.mint} />
        <Text style={styles.placeText}>
          留在「{rec.place.name}」{rec.place.distanceM > 0 ? ` · ${formatDistance(rec.place.distanceM)}` : ''}
        </Text>
      </Pressable>

      <View style={styles.actions}>
        <IconButton
          icon={liked ? 'heart' : 'heart-outline'}
          label="点赞"
          active={liked}
          color={colors.pink}
          onPress={onLike}
          badge={rec.placeSong.likes}
          testID="now-like"
        />
        <IconButton icon="play-skip-forward" label="换一首" onPress={onNext} testID="now-next" />
        <Button
          label="在 QQ 音乐听"
          icon="play"
          size="md"
          onPress={() => void Linking.openURL(qqMusicUrl(song))}
          style={{ flex: 1 }}
          testID="now-play"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 14,
    overflow: 'hidden',
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  kicker: { color: colors.lime, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },
  artist: { color: colors.sub, fontSize: 14, fontWeight: '600' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  reason: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(154,140,255,0.10)',
    borderRadius: radius.md,
    padding: 12,
  },
  reasonText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  placeText: { color: colors.mint, fontSize: 13, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
