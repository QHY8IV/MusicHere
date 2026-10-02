import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, qqMusicUrl, type PlaceSong } from '../lib/api';
import { confirmAction, useToast } from '../lib/feedback';
import { EVENT_LABEL, formatDistance, timeAgo } from '../lib/format';
import { colors, radius } from '../lib/theme';
import { Artwork } from './Art';
import { KindBadge, MoodChip, Pill, Txt } from './ui';

/**
 * 一首歌。compact：列表里的一行（封面、歌名、理由、点赞、去 QQ 音乐听）；
 * full：地点页里的完整卡片（多了点踩、我也在听、现场信息、听众原话、删除）。
 */
export function SongRow({
  item,
  userId,
  reason,
  moods,
  place,
  variant = 'compact',
  onChange,
  onDeleted,
  onPressPlace,
  rank,
}: {
  item: PlaceSong;
  userId: string;
  reason?: string;
  moods?: string[];
  place?: { id: string; name: string; distanceM?: number | null };
  variant?: 'compact' | 'full';
  onChange: (next: PlaceSong) => void;
  onDeleted?: (id: string) => void;
  onPressPlace?: () => void;
  rank?: number;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const mine = item.submittedBy?.id === userId;

  const run = async (fn: () => Promise<{ placeSong: PlaceSong }>, ok?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      onChange((await fn()).placeSong);
      if (ok) toast.show(ok);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '操作失败', 'error');
    } finally {
      setBusy(false);
    }
  };
  const vote = (v: 1 | -1) => run(() => api.vote(item.id, item.myVote === v ? 0 : v));
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
  const play = () => void Linking.openURL(qqMusicUrl(item.song));

  const live = item.live;
  const liveLine = live
    ? [live.eventType ? EVENT_LABEL[live.eventType] : null, live.performer, live.eventAt].filter(Boolean).join(' · ')
    : null;

  const head = (
    <View style={styles.row}>
      {rank !== undefined ? <Text style={styles.rank}>{rank}</Text> : null}
      <Artwork title={item.song.title} artist={item.song.artist} size={variant === 'full' ? 56 : 50} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.title} numberOfLines={1} testID="song-title">
          {item.song.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {item.song.artist}
          {place ? (
            <Text style={styles.placeInline} onPress={onPressPlace}>
              {'  ·  '}
              {place.name}
              {place.distanceM ? ` ${formatDistance(place.distanceM)}` : ''}
            </Text>
          ) : null}
        </Text>
      </View>
      <Pressable
        onPress={() => vote(1)}
        style={[styles.like, item.myVote === 1 && styles.likeOn]}
        accessibilityRole="button"
        accessibilityLabel="点赞"
        testID="like"
      >
        <Ionicons name={item.myVote === 1 ? 'heart' : 'heart-outline'} size={16} color={item.myVote === 1 ? colors.pink : colors.sub} />
        <Text style={[styles.likeText, item.myVote === 1 && { color: colors.pink }]}>{item.likes}</Text>
      </Pressable>
      <Pressable onPress={play} style={styles.play} accessibilityRole="button" accessibilityLabel="在QQ音乐听" testID="play-qq">
        <Ionicons name="play" size={15} color={colors.ink} />
      </Pressable>
    </View>
  );

  if (variant === 'compact') {
    return (
      <View style={styles.compact}>
        {head}
        {reason ? (
          <View style={[styles.reasonRow, { paddingLeft: rank !== undefined ? 92 : 62 }]}>
            <Ionicons name="sparkles" size={12} color={colors.violet} />
            <Text style={styles.reason} numberOfLines={2} testID="song-reason">
              {reason}
            </Text>
          </View>
        ) : null}
        {moods && moods.length ? (
          <View style={[styles.wrap, { paddingLeft: rank !== undefined ? 92 : 62 }]}>
            {moods.slice(0, 3).map((m) => (
              <MoodChip key={m} mood={m} size="sm" />
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.full}>
      {head}
      <View style={styles.wrap}>
        <KindBadge kind={item.kind} />
        {item.source === 'official' && <Pill label="官方记录" icon="ribbon" color={colors.gold} />}
        {liveLine ? <Pill label={liveLine} color={colors.sunset} /> : null}
      </View>
      {live?.eventTitle ? <Txt v="sub">{live.eventTitle}</Txt> : null}
      {item.note ? <Text style={styles.note}>“{item.note}”</Text> : null}
      <View style={styles.actions}>
        <Action
          icon={item.myVote === -1 ? 'thumbs-down' : 'thumbs-down-outline'}
          label={String(item.dislikes)}
          active={item.myVote === -1}
          color={colors.red}
          onPress={() => vote(-1)}
          testID="dislike"
        />
        <Action
          icon={item.listenedToday ? 'headset' : 'headset-outline'}
          label={item.listeners > 0 ? `${item.listeners} 人在听` : '我也在听'}
          active={item.listenedToday}
          color={colors.sky}
          onPress={() => (item.listenedToday ? undefined : run(() => api.listen(item.id), '已记下，这里的「常听」热度 +1'))}
          testID="listen"
        />
        <View style={{ flex: 1 }} />
        {mine ? (
          <Pressable onPress={remove} hitSlop={8} accessibilityLabel="删除">
            <Ionicons name="trash-outline" size={17} color={colors.faint} />
          </Pressable>
        ) : null}
      </View>
      <Txt v="caption">
        {item.submittedBy ? `${item.submittedBy.nickname} · ${timeAgo(item.createdAt)}` : '官方记录'}
      </Txt>
    </View>
  );
}

function Action({
  icon,
  label,
  active,
  color,
  onPress,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active: boolean;
  color: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.action, active && { borderColor: `${color}88`, backgroundColor: `${color}1A` }]}
    >
      <Ionicons name={icon} size={14} color={active ? color : colors.sub} />
      <Text style={[styles.actionText, active && { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: { gap: 8, paddingVertical: 10 },
  full: {
    gap: 10,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rank: { width: 18, color: colors.faint, fontSize: 15, fontWeight: '900', textAlign: 'center' },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  artist: { color: colors.sub, fontSize: 13 },
  placeInline: { color: colors.mint, fontWeight: '700' },
  like: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  likeOn: { backgroundColor: `${colors.pink}1F` },
  likeText: { color: colors.sub, fontSize: 12, fontWeight: '800' },
  play: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  reason: { flex: 1, color: colors.sub, fontSize: 12, lineHeight: 17 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  note: { color: colors.text, fontSize: 14, lineHeight: 21, fontStyle: 'italic', opacity: 0.9 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  actionText: { color: colors.sub, fontSize: 12, fontWeight: '700' },
});
