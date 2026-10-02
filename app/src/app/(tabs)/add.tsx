import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Artwork } from '../../components/Art';
import { CoverButtons } from '../../components/CoverButtons';
import { LocationGate } from '../../components/LocationGate';
import { Button, Card, Chip, ErrorState, Field, Loading, Screen, Txt } from '../../components/ui';
import { api, type Category, type EventType, type Kind, type NewPlaceSong, type PickedImage, type Place } from '../../lib/api';
import { useToast } from '../../lib/feedback';
import { CATEGORY_LABEL, EVENT_LABEL, KIND_HINT, KIND_ICON, KIND_LABEL, formatDistance, todayISO } from '../../lib/format';
import type { Coords } from '../../lib/location';
import { colors, kindColor, radius } from '../../lib/theme';
import { useAsync } from '../../lib/useAsync';

export default function AddTab() {
  return <LocationGate>{(coords) => <AddSong coords={coords} />}</LocationGate>;
}

const NEW = 'new';
const KINDS: Kind[] = ['vibe', 'frequent', 'live'];

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card style={{ gap: 14 }}>
      <View style={styles.stepHead}>
        <View style={styles.stepNum}>
          <Text style={styles.stepNumText}>{n}</Text>
        </View>
        <Txt v="title">{title}</Txt>
      </View>
      {children}
    </Card>
  );
}

function AddSong({ coords }: { coords: Coords }) {
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ placeId?: string }>();
  const key = `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`;

  const nearby = useAsync(() => api.nearby(coords, 300), [key]);
  // 从某个地点页点进来时，该地点可能不在 300 米内（比如远程补充演出记录）
  const requested = useAsync(() => api.place(params.placeId!), [params.placeId], !!params.placeId);

  const places = useMemo(() => {
    const list = nearby.data?.places ?? [];
    const extra = requested.data?.place;
    return extra && !list.some((p) => p.id === extra.id) ? [extra, ...list] : list;
  }, [nearby.data, requested.data]);

  const [placeId, setPlaceId] = useState<string | null>(null);
  const [placeName, setPlaceName] = useState('');
  const [category, setCategory] = useState<Category | undefined>();
  const [cover, setCover] = useState<PickedImage | null>(null);
  const [kind, setKind] = useState<Kind>('vibe');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [eventType, setEventType] = useState<EventType>('busker');
  const [performer, setPerformer] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventAt, setEventAt] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 默认选中：指定的地点 > 你所在的地点 > 最近的地点 > 新建
  const loaded = !!nearby.data && (!params.placeId || !!requested.data || !!requested.error);
  useEffect(() => {
    if (!loaded || placeId !== null) return;
    const inside = places.find((p) => p.distanceM !== null && p.distanceM <= p.radiusM);
    setPlaceId(params.placeId && places.some((p) => p.id === params.placeId) ? params.placeId : ((inside ?? places[0])?.id ?? NEW));
  }, [loaded, placeId, places, params.placeId]);

  if (!nearby.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        {nearby.error ? <ErrorState message={nearby.error} onRetry={nearby.reload} /> : <Loading />}
      </View>
    );
  }

  const isNew = placeId === NEW;

  const helpWrite = async () => {
    if (!title.trim() || !artist.trim()) return setError('先填歌名和歌手，AI 才知道写什么');
    setWriting(true);
    setError(null);
    try {
      const r = await api.caption({ ...(placeId && !isNew ? { placeId } : {}), title: title.trim(), artist: artist.trim() });
      setNote(r.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : '没写出来，再试一次');
    } finally {
      setWriting(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (isNew && !placeName.trim()) return setError('给这个新地点起个名字');
    if (!title.trim() || !artist.trim()) return setError('歌名和歌手都要填');
    if (kind === 'live' && !/^\d{4}-\d{2}-\d{2}$/.test(eventAt.trim())) return setError('演出日期格式应为 2026-05-20');

    setBusy(true);
    try {
      let target: Place | undefined = places.find((p) => p.id === placeId);
      if (isNew) {
        const made = await api.createPlace({ ...coords, name: placeName.trim(), category });
        target = made.place;
        // 照片传失败不应拦住分享：歌比图片重要，失败只提示
        if (cover && made.place.canSetImage) {
          try {
            await api.uploadPlaceImage(made.place.id, cover);
          } catch (err) {
            toast.show(err instanceof Error ? `地点已创建，但照片上传失败：${err.message}` : '照片上传失败', 'error');
          }
        }
      }
      if (!target) return setError('请选择一个地点');

      const input: NewPlaceSong = { title: title.trim(), artist: artist.trim(), kind };
      if (url.trim()) input.url = url.trim();
      if (note.trim()) input.note = note.trim();
      if (kind === 'live') {
        input.eventType = eventType;
        input.eventAt = eventAt.trim();
        if (performer.trim()) input.performer = performer.trim();
        if (eventTitle.trim()) input.eventTitle = eventTitle.trim();
      }
      const res = await api.addSong(target.id, input);
      toast.show(res.created ? `已分享到「${target.name}」` : '这首歌已经在这里了，已为它点赞 +1');
      setTitle('');
      setArtist('');
      setUrl('');
      setNote('');
      setPerformer('');
      setEventTitle('');
      setPlaceName('');
      setCover(null);
      setPlaceId(null);
      nearby.reload();
      router.push(`/place/${target.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="screen-add" glow={colors.mint}>
      <View style={{ gap: 6 }}>
        <Txt v="display">分享一首歌</Txt>
        <Txt v="sub">路过一个很有氛围的地方？把此刻最配的那首歌留在这里。</Txt>
      </View>

      <Step n={1} title="在哪里">
        <View style={styles.wrap}>
          {places.map((p) => (
            <Chip
              key={p.id}
              label={`${p.name}${p.distanceM !== null ? ` · ${formatDistance(p.distanceM)}` : ''}`}
              selected={placeId === p.id}
              onPress={() => setPlaceId(p.id)}
              icon="location"
            />
          ))}
          <Chip label="新地点（就在这里）" selected={isNew} onPress={() => setPlaceId(NEW)} icon="add" testID="new-place" />
        </View>
        {isNew ? (
          <View style={{ gap: 12 }}>
            <Field
              label="地点名称"
              value={placeName}
              onChangeText={setPlaceName}
              placeholder="例如：江边步道、街角咖啡馆"
              maxLength={60}
              testID="place-name"
            />
            <Text style={styles.label}>类型（可选）</Text>
            <View style={styles.wrap}>
              {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                <Chip key={c} label={CATEGORY_LABEL[c]} selected={category === c} onPress={() => setCategory(category === c ? undefined : c)} />
              ))}
            </View>
            <Text style={styles.label}>这里的照片（可选，会作为地点背景）</Text>
            {cover ? <Image source={{ uri: cover.uri }} style={styles.preview} resizeMode="cover" testID="cover-preview" /> : null}
            <CoverButtons onPicked={setCover} />
            <Txt v="caption">将以你当前的位置创建，200 米内同名地点会自动合并。</Txt>
          </View>
        ) : null}
      </Step>

      <Step n={2} title="这首歌和这里的关系">
        <View style={styles.kinds}>
          {KINDS.map((k) => {
            const on = kind === k;
            return (
              <View key={k} style={{ flex: 1 }}>
                <Chip
                  label={KIND_LABEL[k]}
                  icon={KIND_ICON[k]}
                  selected={on}
                  color={kindColor[k]}
                  onPress={() => setKind(k)}
                  testID={`kind-${k}`}
                />
              </View>
            );
          })}
        </View>
        <Txt v="sub">{KIND_HINT[kind]}</Txt>
      </Step>

      <Step n={3} title="歌曲">
        {title.trim() && artist.trim() ? (
          <View style={styles.songPreview}>
            <Artwork title={title} artist={artist} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.previewTitle}>{title}</Text>
              <Text style={styles.previewArtist}>{artist}</Text>
            </View>
          </View>
        ) : null}
        <Field label="歌名" value={title} onChangeText={setTitle} placeholder="例如：晴天" maxLength={120} testID="song-title-input" />
        <Field label="歌手 / 乐队" value={artist} onChangeText={setArtist} placeholder="例如：周杰伦" maxLength={120} testID="song-artist-input" />
        <Field
          label="一句话感受（可选）"
          value={note}
          onChangeText={setNote}
          placeholder="为什么这首歌属于这里？"
          multiline
          maxLength={300}
          testID="song-note-input"
          right={<Button label="帮我写" icon="sparkles" variant="subtle" size="sm" loading={writing} onPress={helpWrite} testID="help-write" />}
        />
        <Field
          label="播放链接（可选）"
          value={url}
          onChangeText={setUrl}
          placeholder="粘贴 QQ 音乐等平台的歌曲链接；不填则自动跳 QQ 音乐搜索"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
      </Step>

      {kind === 'live' ? (
        <Step n={4} title="现场信息">
          <View style={styles.wrap}>
            {(Object.keys(EVENT_LABEL) as EventType[]).map((t) => (
              <Chip key={t} label={EVENT_LABEL[t]} selected={eventType === t} color={colors.sunset} onPress={() => setEventType(t)} />
            ))}
          </View>
          <Field label="演出者（可选）" value={performer} onChangeText={setPerformer} placeholder="乐队 / 艺人 / 街头歌手" maxLength={80} />
          <Field label="演出名称（可选）" value={eventTitle} onChangeText={setEventTitle} placeholder="例如：夏夜露天音乐会" maxLength={120} />
          <Field label="日期" value={eventAt} onChangeText={setEventAt} placeholder="2026-05-20" maxLength={10} autoCapitalize="none" />
        </Step>
      ) : null}

      {error ? (
        <Text style={styles.error} testID="form-error">
          {error}
        </Text>
      ) : null}
      <Button label="留在这里" icon="pin" size="lg" onPress={submit} loading={busy} testID="submit-song" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kinds: { flexDirection: 'row', gap: 8 },
  label: { color: colors.sub, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  preview: { width: '100%', height: 160, borderRadius: radius.lg },
  songPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  previewTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  previewArtist: { color: colors.sub, fontSize: 12 },
  error: { color: colors.red, fontSize: 14 },
});
