import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CommentItem } from '../../components/CommentItem';
import { SongCard } from '../../components/SongCard';
import { Button, Card, Chip, EmptyState, ErrorState, Field, Loading, Muted, Pill, Screen, SectionTitle } from '../../components/ui';
import { api, ApiError, type CheckinResult, type Comment, type Kind, type PlaceSong } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/feedback';
import { CATEGORY_LABEL, KIND_ICON, KIND_LABEL, MOODS, checkinAllowanceM, formatDistance } from '../../lib/format';
import { useLocation } from '../../lib/location';
import { colors } from '../../lib/theme';
import { useAsync } from '../../lib/useAsync';

type Tab = Kind | 'comments';
const KINDS: Kind[] = ['vibe', 'frequent', 'live'];

export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { coords, refresh } = useLocation();

  const posKey = coords ? `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}` : 'none';
  const place = useAsync(() => api.place(id, coords ?? undefined), [id, posKey]);
  const songs = useAsync(() => api.songs(id), [id]);
  const comments = useAsync(() => api.comments(id), [id]);

  const [tab, setTab] = useState<Tab>('vibe');
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkin, setCheckin] = useState<CheckinResult | null>(null);

  const grouped = useMemo(() => {
    const g: Record<Kind, PlaceSong[]> = { vibe: [], frequent: [], live: [] };
    for (const s of songs.data?.songs ?? []) g[s.kind].push(s);
    return g;
  }, [songs.data]);

  if (!place.data) {
    return place.error ? <ErrorState message={place.error} onRetry={place.reload} /> : <Loading />;
  }
  const p = place.data.place;
  const allowance = checkinAllowanceM(p.radiusM);
  const inRange = p.distanceM !== null && p.distanceM <= allowance;

  const doCheckin = async () => {
    const here = coords ?? (await refresh());
    if (!here) return toast.show('需要定位才能打卡', 'error');
    setCheckingIn(true);
    try {
      const res = await api.checkin(p.id, here);
      setCheckin(res);
      toast.show(res.repeat ? '你刚刚已经在这里打过卡了' : res.firstVisit ? '打卡成功！这是你第一次来这里' : '打卡成功！欢迎回来');
      void Promise.all([place.reload(), songs.reload()]);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'too_far') {
        toast.show(`你离这里还有 ${formatDistance(Number(err.data.distanceM))}，靠近些再打卡`, 'error');
      } else {
        toast.show(err instanceof Error ? err.message : '打卡失败', 'error');
      }
    } finally {
      setCheckingIn(false);
    }
  };

  const patchSong = (next: PlaceSong) =>
    songs.setData((d) => d && { songs: d.songs.map((s) => (s.id === next.id ? next : s)) });
  const dropSong = (sid: string) => songs.setData((d) => d && { songs: d.songs.filter((s) => s.id !== sid) });
  const patchComment = (next: Comment) =>
    comments.setData((d) => d && { ...d, comments: d.comments.map((c) => (c.id === next.id ? next : c)) });
  const dropComment = (cid: string) =>
    comments.setData((d) => d && { ...d, comments: d.comments.filter((c) => c.id !== cid) });

  return (
    <Screen
      refreshing={place.loading}
      onRefresh={async () => {
        await Promise.all([place.reload(), songs.reload(), comments.reload()]);
      }}
    >
      <Stack.Screen options={{ title: p.name }} />

      <Card>
        <Text style={styles.name} testID="place-name-title">{p.name}</Text>
        <View style={styles.pills}>
          {p.category && <Pill label={CATEGORY_LABEL[p.category]} />}
          {p.distanceM !== null && <Pill label={`距你 ${formatDistance(p.distanceM)}`} icon="walk" />}
        </View>
        {p.description ? <Text style={styles.desc}>{p.description}</Text> : null}
        <Muted>
          {p.songCount} 首歌 · {p.visitorCount} 人来过 · {p.commentCount} 条评论
        </Muted>

        {checkin ? (
          <View style={styles.done} testID="checkin-done">
            <Text style={styles.doneTitle}>✓ 已打卡</Text>
            <Muted>你是第 {checkin.visitorCount} 位来过这里的人。听听这里的声音：</Muted>
            {KINDS.map((k) => (
              <View key={k} style={styles.sumRow}>
                <Pill label={KIND_LABEL[k]} icon={KIND_ICON[k]} tone="accent" />
                <Text style={styles.sumText} numberOfLines={2}>
                  {checkin.songs[k].length === 0
                    ? '暂时没有'
                    : checkin.songs[k]
                        .slice(0, 3)
                        .map((s) => `《${s.song.title}》`)
                        .join(' ')}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={{ gap: 8, marginTop: 4 }}>
            <Button
              label={inRange ? '在这里打卡' : '打卡（需要在现场）'}
              icon="flag"
              onPress={doCheckin}
              loading={checkingIn}
              disabled={!inRange}
              testID="checkin"
            />
            {!coords ? (
              <Muted>开启定位后可以打卡。</Muted>
            ) : !inRange ? (
              <Muted>
                你离这里 {formatDistance(p.distanceM)}，进入 {allowance} 米范围内即可打卡。
              </Muted>
            ) : null}
          </View>
        )}
      </Card>

      <View style={styles.tabs}>
        {KINDS.map((k) => (
          <Chip
            key={k}
            label={`${KIND_LABEL[k]} ${grouped[k].length}`}
            icon={KIND_ICON[k]}
            selected={tab === k}
            onPress={() => setTab(k)}
            testID={`tab-${k}`}
          />
        ))}
        <Chip
          label={`评论 ${p.commentCount}`}
          icon="chatbubble-ellipses"
          selected={tab === 'comments'}
          onPress={() => setTab('comments')}
          testID="tab-comments"
        />
      </View>

      {tab === 'comments' ? (
        <Comments
          placeId={p.id}
          state={comments}
          songs={songs.data?.songs ?? []}
          userId={user!.id}
          onChange={patchComment}
          onDeleted={dropComment}
          onPosted={(c) => {
            comments.setData((d) => ({ comments: [c, ...(d?.comments ?? [])], nextBefore: d?.nextBefore ?? null }));
            void place.reload();
          }}
        />
      ) : (
        <>
          <SectionTitle
            right={
              <Button
                label="添加"
                icon="add"
                small
                variant="ghost"
                onPress={() => router.push({ pathname: '/add', params: { placeId: p.id } })}
              />
            }
          >
            {{ vibe: '觉得很应景的歌', frequent: '这里常听的歌', live: '在这里听到过的现场' }[tab]}
          </SectionTitle>
          {songs.error && !songs.data ? (
            <ErrorState message={songs.error} onRetry={songs.reload} />
          ) : !songs.data ? (
            <Loading />
          ) : grouped[tab].length === 0 ? (
            <EmptyState
              title="这里还没有"
              message={
                tab === 'live'
                  ? '在这里听到过演唱会、即兴演出或街头艺人？记下来吧。'
                  : '你觉得哪首歌属于这里？分享一首。'
              }
            />
          ) : (
            grouped[tab].map((s) => (
              <SongCard key={s.id} item={s} userId={user!.id} onChange={patchSong} onDeleted={dropSong} />
            ))
          )}
        </>
      )}
    </Screen>
  );
}

function Comments({
  placeId,
  state,
  songs,
  userId,
  onChange,
  onDeleted,
  onPosted,
}: {
  placeId: string;
  state: ReturnType<typeof useAsync<{ comments: Comment[]; nextBefore: string | null }>>;
  songs: PlaceSong[];
  userId: string;
  onChange: (c: Comment) => void;
  onDeleted: (id: string) => void;
  onPosted: (c: Comment) => void;
}) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [mood, setMood] = useState<string | undefined>();
  const [songId, setSongId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);

  const post = async () => {
    if (!body.trim()) return toast.show('写点什么吧', 'error');
    setBusy(true);
    try {
      const { comment } = await api.addComment(placeId, { body: body.trim(), mood, placeSongId: songId });
      onPosted(comment);
      setBody('');
      setMood(undefined);
      setSongId(undefined);
      toast.show('评论已发布');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '发布失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const loadMore = async () => {
    if (!state.data?.nextBefore) return;
    setMore(true);
    try {
      const page = await api.comments(placeId, state.data.nextBefore);
      state.setData((d) => ({ comments: [...(d?.comments ?? []), ...page.comments], nextBefore: page.nextBefore }));
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '加载失败', 'error');
    } finally {
      setMore(false);
    }
  };

  return (
    <>
      <Card>
        <Field
          label="说说你在这里的感受"
          value={body}
          onChangeText={setBody}
          placeholder="此刻的天气、人群、氛围，或者哪首歌最配这里……"
          multiline
          maxLength={500}
          testID="comment-input"
        />
        <View style={styles.pills}>
          {MOODS.map((m) => (
            <Chip key={m} label={m} selected={mood === m} onPress={() => setMood(mood === m ? undefined : m)} />
          ))}
        </View>
        {songs.length > 0 && (
          <>
            <Muted>关联一首这里的歌（可选）</Muted>
            <View style={styles.pills}>
              {songs.slice(0, 6).map((s) => (
                <Chip
                  key={s.id}
                  label={`《${s.song.title}》`}
                  selected={songId === s.id}
                  onPress={() => setSongId(songId === s.id ? undefined : s.id)}
                />
              ))}
            </View>
          </>
        )}
        <Button label="发布" icon="send" onPress={post} loading={busy} testID="post-comment" />
      </Card>

      {state.error && !state.data ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <Loading />
      ) : state.data.comments.length === 0 ? (
        <EmptyState icon="chatbubble-outline" title="还没有评论" message="来写下第一条吧。" />
      ) : (
        <>
          {state.data.comments.map((c) => (
            <CommentItem key={c.id} comment={c} userId={userId} onChange={onChange} onDeleted={onDeleted} />
          ))}
          {state.data.nextBefore ? <Button label="加载更多" variant="ghost" loading={more} onPress={loadMore} /> : null}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.text, fontSize: 24, fontWeight: '900' },
  desc: { color: colors.text, fontSize: 14, lineHeight: 21 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  done: {
    marginTop: 6,
    padding: 12,
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.green,
    backgroundColor: '#4ADE9A14',
  },
  doneTitle: { color: colors.green, fontSize: 16, fontWeight: '800' },
  sumRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sumText: { color: colors.text, fontSize: 13, flex: 1 },
});
