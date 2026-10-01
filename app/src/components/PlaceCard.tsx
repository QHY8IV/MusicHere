import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Place } from '../lib/api';
import { CATEGORY_LABEL, KIND_LABEL, formatDistance } from '../lib/format';
import { colors } from '../lib/theme';
import { PlaceCover } from './PlaceCover';
import { Card, Muted, Pill } from './ui';

export function PlaceCard({ place, onPress }: { place: Place; onPress: () => void }) {
  const inside = place.distanceM !== null && place.distanceM <= place.radiusM;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID="place-card">
      <Card style={styles.card}>
        <PlaceCover place={place} height={132}>
          <View style={styles.row}>
            <Text style={styles.name}>{place.name}</Text>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </View>
          <View style={styles.pills}>
            {inside && <Pill label="你在这里" icon="navigate" tone="accent" />}
            {place.category && <Pill label={CATEGORY_LABEL[place.category]} />}
            {place.distanceM !== null && !inside && <Pill label={formatDistance(place.distanceM)} />}
          </View>
        </PlaceCover>
        <View style={styles.body}>
          {place.topSong ? (
            <Text style={styles.top} numberOfLines={1}>
              ♪ {KIND_LABEL[place.topSong.kind]}：《{place.topSong.title}》 · {place.topSong.artist}
            </Text>
          ) : (
            <Muted>还没有人分享歌曲，来做第一个吧</Muted>
          )}
          <Muted>
            {place.songCount} 首歌 · {place.visitorCount} 人来过 · {place.commentCount} 条评论
          </Muted>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, gap: 0, overflow: 'hidden' },
  body: { padding: 14, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  name: { color: '#fff', fontSize: 20, fontWeight: '800', flex: 1 },
  pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  top: { color: colors.text, fontSize: 14 },
});
