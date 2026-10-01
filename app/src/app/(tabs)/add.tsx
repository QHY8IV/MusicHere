import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LocationGate } from '../../components/LocationGate';
import { Button, Card, Chip, ErrorState, Field, Loading, Muted, Screen, SectionTitle, Title } from '../../components/ui';
import { api, type Category, type EventType, type Kind, type NewPlaceSong, type Place } from '../../lib/api';
import { useToast } from '../../lib/feedback';
import {
  CATEGORY_LABEL,
  EVENT_LABEL,
  KIND_HINT,
  KIND_ICON,
  KIND_LABEL,
  formatDistance,
  todayISO,
} from '../../lib/format';
import type { Coords } from '../../lib/location';
import { colors } from '../../lib/theme';
import { useAsync } from '../../lib/useAsync';

export default function AddTab() {
  return <LocationGate>{(coords) => <AddSong coords={coords} />}</LocationGate>;
}

const NEW = 'new';
const KINDS: Kind[] = ['vibe', 'frequent', 'live'];

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
  const [error, setError] = useState<string | null>(null);

  // 默认选中：指定的地点 > 你所在的地点 > 最近的地点 > 新建
  const loaded = !!nearby.data && (!params.placeId || !!requested.data || !!requested.error);
  useEffect(() => {
    if (!loaded || placeId !== null) return;
    const inside = places.find((p) => p.distanceM !== null && p.distanceM <= p.radiusM);
    setPlaceId(params.placeId && places.some((p) => p.id === params.placeId) ? params.placeId : (inside ?? places[0])?.id ?? NEW);
  }, [loaded, placeId, places, params.placeId]);

  if (!nearby.data) {
    return nearby.error ? <ErrorState message={nearby.error} onRetry={nearby.reload} /> : <Loading />;
  }

  const isNew = placeId === NEW;

  const submit = async () => {
    setError(null);
    if (isNew && !placeName.trim()) return setError('给这个新地点起个名字');
    if (!title.trim() || !artist.trim()) return setError('歌名和歌手都要填');
    if (kind === 'live' && !/^\d{4}-\d{2}-\d{2}$/.test(eventAt.trim())) return setError('演出日期格式应为 2026-05-20');

    setBusy(true);
    try {
      let target: Place | undefined = places.find((p) => p.id === placeId);
      if (isNew) {
        target = (await api.createPlace({ ...coords, name: placeName.trim(), category })).place;
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
    <Screen>
      <Title>分享一首歌</Title>

      <SectionTitle>1 · 在哪里</SectionTitle>
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
      {isNew && (
        <Card>
          <Field label="地点名称" value={placeName} onChangeText={setPlaceName} placeholder="例如：江边步道、街角咖啡馆" maxLength={60} testID="place-name" />
          <Text style={styles.label}>类型（可选）</Text>
          <View style={styles.wrap}>
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
              <Chip key={c} label={CATEGORY_LABEL[c]} selected={category === c} onPress={() => setCategory(category === c ? undefined : c)} />
            ))}
          </View>
          <Muted>将以你当前的位置创建，200 米内同名地点会自动合并。</Muted>
        </Card>
      )}

      <SectionTitle>2 · 这首歌和这里的关系</SectionTitle>
      <View style={styles.wrap}>
        {KINDS.map((k) => (
          <Chip key={k} label={KIND_LABEL[k]} icon={KIND_ICON[k]} selected={kind === k} onPress={() => setKind(k)} testID={`kind-${k}`} />
        ))}
      </View>
      <Muted>{KIND_HINT[kind]}</Muted>

      <SectionTitle>3 · 歌曲</SectionTitle>
      <Card>
        <Field label="歌名" value={title} onChangeText={setTitle} placeholder="例如：晴天" maxLength={120} testID="song-title-input" />
        <Field label="歌手 / 乐队" value={artist} onChangeText={setArtist} placeholder="例如：周杰伦" maxLength={120} testID="song-artist-input" />
        <Field
          label="播放链接（可选）"
          value={url}
          onChangeText={setUrl}
          placeholder="粘贴网易云 / QQ 音乐 / Spotify 等链接"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          hint="别人点开就能直接听"
        />
        <Field label="一句话感受（可选）" value={note} onChangeText={setNote} placeholder="为什么这首歌属于这里？" multiline maxLength={300} />
      </Card>

      {kind === 'live' && (
        <>
          <SectionTitle>4 · 现场信息</SectionTitle>
          <Card>
            <Text style={styles.label}>演出类型</Text>
            <View style={styles.wrap}>
              {(Object.keys(EVENT_LABEL) as EventType[]).map((t) => (
                <Chip key={t} label={EVENT_LABEL[t]} selected={eventType === t} onPress={() => setEventType(t)} />
              ))}
            </View>
            <Field label="演出者（可选）" value={performer} onChangeText={setPerformer} placeholder="乐队 / 艺人 / 街头歌手" maxLength={80} />
            <Field label="演出名称（可选）" value={eventTitle} onChangeText={setEventTitle} placeholder="例如：夏夜露天音乐会" maxLength={120} />
            <Field label="日期" value={eventAt} onChangeText={setEventAt} placeholder="2026-05-20" maxLength={10} autoCapitalize="none" />
          </Card>
        </>
      )}

      {error ? <Text style={styles.error} testID="form-error">{error}</Text> : null}
      <Button label="分享" icon="paper-plane" onPress={submit} loading={busy} testID="submit-song" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  label: { color: colors.sub, fontSize: 13, fontWeight: '600' },
  error: { color: colors.red, fontSize: 14 },
});
