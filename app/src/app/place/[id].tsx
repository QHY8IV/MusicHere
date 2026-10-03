import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottleReveal, ThrowBottle } from '../../components/Bottle';
import { CommentItem } from '../../components/CommentItem';
import { CoverButtons } from '../../components/CoverButtons';
import { PersonaCard } from '../../components/PersonaCard';
import { PlaceCover } from '../../components/PlaceCover';
import { PostcardSheet, type PostcardData } from '../../components/Postcard';
import { QuizCard, QuizGame } from '../../components/Quiz';
import { SongRow } from '../../components/SongRow';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  KindBadge,
  Loading,
  Pill,
  Segmented,
  Txt,
} from '../../components/ui';
import {
  api,
  ApiError,
  type Bottle,
  type CheckinResult,
  type Comment,
  type Kind,
  type PickedImage,
  type PlaceSong,
} from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/feedback';
import { CATEGORY_LABEL, KIND_LABEL, MOODS, checkinAllowanceM, formatDistance } from '../../lib/format';
import { useLocation } from '../../lib/location';
import { colors, kindColor, radius } from '../../lib/theme';
import { useAsync } from '../../lib/useAsync';

type Tab = Kind | 'comments';
const KINDS: Kind[] = ['vibe', 'frequent', 'live'];
const TAB_TITLE: Record<Kind, string> = { vibe: '觉得很应景的歌', frequent: '这里常听的歌', live: '在这里听到过的现场' };

export default function PlaceScreen() {
  const { id, play } = useLocalSearchParams<{ id: string; play?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user } = useAuth();
  const { coords, refresh } = useLocation();

  const posKey = coords ? `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}` : 'none';
  const place = useAsync(() => api.place(id, coords ?? undefined), [id, posKey]);
  const songs = useAsync(() => api.songs(id), [id]);
  const comments = useAsync(() => api.comments(id), [id]);
  const persona = useAsync(() => api.persona(id), [id]);
  const waiting = useAsync(() => api.waitingBottles(id), [id]);
  const board = useAsync(() => api.quizBoard(id), [id]);

  const [tab, setTab] = useState<Tab>('vibe');
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkin, setCheckin] = useState<CheckinResult | null>(null);
  const [bottle, setBottle] = useState<Bottle | null>(null);
  const [throwing, setThrowing] = useState(false);
  const [postcard, setPostcard] = useState<PostcardData | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  // 从首页「猜歌」进来时直接开一局
  const [playing, setPlaying] = useState(play === '1');

  const grouped = useMemo(() => {
    const g: Record<Kind, PlaceSong[]> = { vibe: [], frequent: [], live: [] };
    for (const s of songs.data?.songs ?? []) g[s.kind].push(s);
    return g;
  }, [songs.data]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!place.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        {place.error ? <ErrorState message={place.error} onRetry={place.reload} /> : <Loading />}
      </View>
    );
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
      if (res.bottle) setBottle(res.bottle);
      toast.show(res.repeat ? '你刚刚已经在这里打过卡了' : res.firstVisit ? '打卡成功！这是你第一次来这里' : '打卡成功！欢迎回来');
      void Promise.all([place.reload(), songs.reload(), persona.reload(), waiting.reload()]);
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

  const setCover = async (img: PickedImage) => {
    setCoverBusy(true);
    try {
      await api.uploadPlaceImage(p.id, img);
      await place.reload();
      toast.show('封面已更新');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '上传失败', 'error');
    } finally {
      setCoverBusy(false);
    }
  };

  const openPostcard = () => {
    const top = songs.data?.songs[0];
    if (!top) return toast.show('这里还没有歌，先留下一首吧', 'error');
    setPostcard({ place: p, song: { title: top.song.title, artist: top.song.artist }, nickname: user!.nickname });
  };

  const patchSong = (next: PlaceSong) => songs.setData((d) => d && { songs: d.songs.map((s) => (s.id === next.id ? next : s)) });
  const dropSong = (sid: string) => songs.setData((d) => d && { songs: d.songs.filter((s) => s.id !== sid) });
  const patchComment = (next: Comment) =>
    comments.setData((d) => d && { ...d, comments: d.comments.map((c) => (c.id === next.id ? next : c)) });
  const dropComment = (cid: string) => comments.setData((d) => d && { ...d, comments: d.comments.filter((c) => c.id !== cid) });
  const waitingCount = waiting.data?.count ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <PlaceCover
          place={p}
          height={360 + insets.top}
          topRight={p.canSetImage ? <CoverButtons compact onPicked={setCover} busy={coverBusy} /> : undefined}
        >
          <View style={styles.wrap}>
            {p.category ? <Pill label={CATEGORY_LABEL[p.category]} color="#ffffff" /> : null}
            {p.distanceM !== null ? <Pill label={`距你 ${formatDistance(p.distanceM)}`} icon="walk" color="#ffffff" /> : null}
          </View>
          <Text style={styles.name} testID="place-name-title">
            {p.name}
          </Text>
          {p.description ? <Text style={styles.desc}>{p.description}</Text> : null}
        </PlaceCover>
        <IconButton icon="chevron-back" label="返回" onPress={goBack} style={[styles.back, { top: insets.top + 12 }]} />

        <View style={styles.body}>
          {/* 打卡与漂流瓶 */}
          {checkin ? (
            <View style={styles.done} testID="checkin-done">
              <LinearGradient colors={['rgba(183,243,107,0.16)', 'rgba(62,230,193,0.04)']} style={StyleSheet.absoluteFill} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="checkmark-circle" size={22} color={colors.lime} />
                <Text style={styles.doneTitle}>已打卡 · 你是第 {checkin.visitorCount} 位来过这里的人</Text>
              </View>
              <Txt v="sub">听听这里的声音：</Txt>
              {KINDS.map((k) => (
                <View key={k} style={styles.sumRow}>
                  <KindBadge kind={k} />
                  <Text style={styles.sumText} numberOfLines={1}>
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
            <Card style={{ gap: 12 }}>
              <Button
                label={inRange ? '在这里打卡' : '打卡（需要在现场）'}
                icon="flag"
                size="lg"
                onPress={doCheckin}
                loading={checkingIn}
                disabled={!inRange}
                testID="checkin"
              />
              <Txt v="sub" style={{ textAlign: 'center' }}>
                {!coords
                  ? '开启定位后可以打卡'
                  : !inRange
                    ? `你离这里 ${formatDistance(p.distanceM)}，进入 ${allowance} 米范围内即可打卡`
                    : waitingCount > 0
                      ? `打卡后会捡起这里的 1 个漂流瓶（共 ${waitingCount} 个在等待）`
                      : '打卡后，你会看到这里所有人留下的歌'}
              </Txt>
            </Card>
          )}

          <View style={styles.actionRow}>
            <Button
              label="投漂流瓶"
              icon="mail"
              variant="subtle"
              onPress={() => setThrowing(true)}
              disabled={!inRange}
              style={{ flex: 1 }}
              testID="throw-open"
            />
            <Button label="声音明信片" icon="image" variant="subtle" onPress={openPostcard} style={{ flex: 1 }} testID="postcard-open" />
          </View>

          {/* 此地知音：猜歌小游戏 */}
          <QuizCard placeName={p.name} board={board.data} inRange={inRange} onStart={() => setPlaying(true)} />

          {/* AI 声音画像 */}
          {persona.data ? <PersonaCard persona={persona.data.persona} /> : <Loading label="AI 正在描绘这里的声音…" />}

          <View style={styles.tabsHead}>
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                ...KINDS.map((k) => ({ key: k, label: KIND_LABEL[k], count: grouped[k].length, color: kindColor[k], testID: `tab-${k}` })),
                { key: 'comments' as Tab, label: '留言', count: p.commentCount, testID: 'tab-comments' },
              ]}
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
            <View style={{ gap: 12 }}>
              <View style={styles.listHead}>
                <Txt v="title">{TAB_TITLE[tab]}</Txt>
                <Button
                  label="添加"
                  icon="add"
                  variant="subtle"
                  size="sm"
                  onPress={() => router.push({ pathname: '/add', params: { placeId: p.id } })}
                  testID="add-song"
                />
              </View>
              {songs.error && !songs.data ? (
                <ErrorState message={songs.error} onRetry={songs.reload} />
              ) : !songs.data ? (
                <Loading />
              ) : grouped[tab].length === 0 ? (
                <EmptyState
                  title="这里还没有"
                  message={tab === 'live' ? '在这里听到过演唱会、即兴演出或街头艺人？记下来吧。' : '你觉得哪首歌属于这里？分享一首。'}
                />
              ) : (
                grouped[tab].map((s) => (
                  <SongRow key={s.id} item={s} userId={user!.id} variant="full" onChange={patchSong} onDeleted={dropSong} />
                ))
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <BottleReveal bottle={bottle} onClose={() => setBottle(null)} />
      <ThrowBottle
        visible={throwing}
        onClose={() => setThrowing(false)}
        placeId={p.id}
        placeName={p.name}
        coords={coords}
        onThrown={() => void waiting.reload()}
      />
      <PostcardSheet data={postcard} onClose={() => setPostcard(null)} />
      <QuizGame
        visible={playing}
        placeId={p.id}
        coords={coords}
        onClose={() => setPlaying(false)}
        onFinished={() => void board.reload()}
      />
    </View>
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
      toast.show('留言已发布');
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
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 12 }}>
        <Field
          label="说说你在这里的感受"
          value={body}
          onChangeText={setBody}
          placeholder="此刻的天气、人群、氛围，或者哪首歌最配这里……"
          multiline
          maxLength={500}
          testID="comment-input"
        />
        <View style={styles.wrap}>
          {MOODS.map((m) => (
            <Chip key={m} label={m} selected={mood === m} onPress={() => setMood(mood === m ? undefined : m)} />
          ))}
        </View>
        {songs.length > 0 ? (
          <>
            <Txt v="caption">关联一首这里的歌（可选）</Txt>
            <View style={styles.wrap}>
              {songs.slice(0, 6).map((s) => (
                <Chip
                  key={s.id}
                  label={`《${s.song.title}》`}
                  selected={songId === s.id}
                  color={colors.mint}
                  onPress={() => setSongId(songId === s.id ? undefined : s.id)}
                />
              ))}
            </View>
          </>
        ) : null}
        <Button label="发布" icon="send" onPress={post} loading={busy} testID="post-comment" />
      </Card>

      {state.error && !state.data ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <Loading />
      ) : state.data.comments.length === 0 ? (
        <EmptyState icon="chatbubble-outline" title="还没有留言" message="来写下第一条吧。" />
      ) : (
        <>
          {state.data.comments.map((c) => (
            <CommentItem key={c.id} comment={c} userId={userId} onChange={onChange} onDeleted={onDeleted} />
          ))}
          {state.data.nextBefore ? <Button label="加载更多" variant="ghost" loading={more} onPress={loadMore} /> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: 16, backgroundColor: 'rgba(7,8,12,0.6)', borderColor: 'rgba(255,255,255,0.18)' },
  name: { color: '#fff', fontSize: 36, fontWeight: '900', letterSpacing: -0.5 },
  desc: { color: 'rgba(255,255,255,0.82)', fontSize: 14, lineHeight: 21 },
  body: { paddingHorizontal: 18, gap: 20, marginTop: -6, maxWidth: 720, width: '100%', alignSelf: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  done: {
    padding: 16,
    gap: 10,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(183,243,107,0.4)',
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  doneTitle: { color: colors.lime, fontSize: 15, fontWeight: '900', flex: 1 },
  sumRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sumText: { color: colors.text, fontSize: 13, flex: 1 },
  actionRow: { flexDirection: 'row', gap: 10 },
  tabsHead: { marginTop: 4 },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
