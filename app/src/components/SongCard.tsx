import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, type PlaceSong } from '../lib/api';
import { confirmAction, useToast } from '../lib/feedback';
import { EVENT_LABEL, KIND_ICON, KIND_LABEL, formatDistance, timeAgo } from '../lib/format';
import { colors, radius } from '../lib/theme';
import { Card, Muted, Pill } from './ui';

interface Props {
  item: PlaceSong;
  userId: string;
  /** 在发现页等跨地点列表里显示所属地点 */
  place?: { id: string; name: string; distanceM?: number | null };
  onChange: (next: PlaceSong) => void;
  onDeleted?: (id: string) => void;
  onPressPlace?: () => void;
}

export function SongCard({ item, userId, place, onChange, onDeleted, onPressPlace }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const mine = item.submittedBy?.id === userId;

  const run = async (fn: () => Promise<{ placeSong: PlaceSong }>, okMessage?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      onChange((await fn()).placeSong);
      if (okMessage) toast.show(okMessage);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '操作失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const vote = (value: 1 | -1) => run(() => api.vote(item.id, item.myVote === value ? 0 : value));

  const remove = async () => {
    if (!(await confirmAction('删除这条记录？', `《${item.song.title}》将从这个地点移除。`, '删除'))) return;
    try {
      await api.deleteSong(item.id);
      onDeleted?.(item.id);
      toast.show('已删除');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '删除失败', 'error');
    }
  };

  const live = item.live;
  const liveLine = live
    ? [live.eventType ? EVENT_LABEL[live.eventType] : null, live.performer, live.eventAt]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <Card>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.song} testID="song-title">{item.song.title}</Text>
          <Text style={styles.artist}>{item.song.artist}</Text>
        </View>
        {item.song.url ? (
          <Pressable
            accessibilityLabel="打开播放链接"
            onPress={() => void Linking.openURL(item.song.url!)}
            hitSlop={8}
            style={styles.play}
          >
            <Ionicons name="play" size={18} color="#fff" />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.pills}>
        <Pill label={KIND_LABEL[item.kind]} icon={KIND_ICON[item.kind]} tone="accent" />
        {item.source === 'official' && <Pill label="官方记录" icon="ribbon" tone="official" />}
        {liveLine ? <Pill label={liveLine} /> : null}
      </View>

      {live?.eventTitle ? <Muted>{live.eventTitle}</Muted> : null}
      {item.note ? <Text style={styles.note}>“{item.note}”</Text> : null}

      {place ? (
        <Pressable onPress={onPressPlace} style={styles.placeRow}>
          <Ionicons name="location" size={14} color={colors.violet} />
          <Text style={styles.placeText}>
            {place.name}
            {place.distanceM ? ` · ${formatDistance(place.distanceM)}` : ''}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        <Action
          testID="like"
          icon={item.myVote === 1 ? 'thumbs-up' : 'thumbs-up-outline'}
          label={String(item.likes)}
          active={item.myVote === 1}
          onPress={() => vote(1)}
          color={colors.accent}
        />
        <Action
          testID="dislike"
          icon={item.myVote === -1 ? 'thumbs-down' : 'thumbs-down-outline'}
          label={String(item.dislikes)}
          active={item.myVote === -1}
          onPress={() => vote(-1)}
          color={colors.red}
        />
        <Action
          testID="listen"
          icon={item.listenedToday ? 'headset' : 'headset-outline'}
          label={item.listeners > 0 ? `${item.listeners} 人在听` : '我也在听'}
          active={item.listenedToday}
          onPress={() => (item.listenedToday ? undefined : run(() => api.listen(item.id), '已记下，这里的“常听”热度 +1'))}
          color={colors.violet}
        />
        <View style={{ flex: 1 }} />
        {mine ? (
          <Pressable onPress={remove} hitSlop={8} accessibilityLabel="删除">
            <Ionicons name="trash-outline" size={18} color={colors.faint} />
          </Pressable>
        ) : null}
      </View>

      <Muted>
        {item.submittedBy ? `${item.submittedBy.nickname} 分享于 ${timeAgo(item.createdAt)}` : '来自官方记录'}
      </Muted>
    </Card>
  );
}

function Action({
  icon,
  label,
  active,
  onPress,
  color,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active: boolean;
  onPress: () => void;
  color: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.action, active && { borderColor: color, backgroundColor: `${color}22` }]}
    >
      <Ionicons name={icon} size={16} color={active ? color : colors.sub} />
      <Text style={[styles.actionText, active && { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  song: { color: colors.text, fontSize: 18, fontWeight: '800' },
  artist: { color: colors.sub, fontSize: 14 },
  play: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  note: { color: colors.text, fontSize: 14, lineHeight: 20, fontStyle: 'italic' },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  placeText: { color: colors.violet, fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: { color: colors.sub, fontSize: 13, fontWeight: '600' },
});
