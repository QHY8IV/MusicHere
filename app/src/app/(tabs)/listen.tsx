import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Artwork } from '../../components/Art';
import { LocationGate } from '../../components/LocationGate';
import { PostcardSheet, type PostcardData } from '../../components/Postcard';
import { SongRow } from '../../components/SongRow';
import {
  AIBadge,
  Button,
  Chip,
  MoodChip,
  NATIVE_DRIVER,
  Pill,
  Screen,
  SectionHeader,
  Txt,
} from '../../components/ui';
import { api, qqMusicUrl, type PlaceSong, type SceneResult } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/feedback';
import type { Coords } from '../../lib/location';
import { pickScenePhoto, type ScenePhoto } from '../../lib/pickImage';
import { colors, moodColor, radius } from '../../lib/theme';

export default function ListenTab() {
  return <LocationGate>{(coords) => <Listen coords={coords} />}</LocationGate>;
}

const PROMPTS = ['日落时分', '下着小雨', '一个人走走', '和朋友在一起', '刚下班', '深夜睡不着', '阳光很好'];
const STEPS = ['读取画面的光线与色彩…', '感受此刻的情绪…', '翻阅这里的人群记忆…', '为你挑选此刻的歌…'];

function Listen({ coords }: { coords: Coords }) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const [photo, setPhoto] = useState<ScenePhoto | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SceneResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [postcard, setPostcard] = useState<PostcardData | null>(null);

  const choose = async (source: 'camera' | 'library') => {
    try {
      const p = await pickScenePhoto(source);
      if (p) setPhoto(p);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '选择照片失败', 'error');
    }
  };

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.scene({
        ...coords,
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(photo ? { image: photo.base64, ...(photo.colorHint ? { colorHint: photo.colorHint } : {}) } : {}),
      });
      setResult(r);
      setAdded({});
    } catch (err) {
      setError(err instanceof Error ? err.message : '没能读懂这里，再试一次');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setPhoto(null);
    setText('');
  };

  const keep = async (title: string, artist: string, reason: string) => {
    if (!result?.place) return;
    try {
      const r = await api.addSong(result.place.id, { title, artist, kind: 'vibe', note: reason.slice(0, 60) });
      setAdded((a) => ({ ...a, [`${title}|${artist}`]: true }));
      toast.show(r.created ? `已把《${title}》留在「${result.place.name}」` : '这首歌已经在这里了，已为它点赞');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '没能留下', 'error');
    }
  };

  const patchCrowd = (next: PlaceSong) =>
    setResult((r) =>
      r && {
        ...r,
        picks: r.picks.map((p) => (p.source === 'crowd' && p.placeSong.id === next.id ? { ...p, placeSong: next } : p)),
      },
    );

  return (
    <Screen glow={colors.violet}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Txt v="display">听这里</Txt>
          <AIBadge />
        </View>
        <Txt v="sub">拍下此刻，或者说一句心情。AI 读懂这里的氛围，再从这里的人群记忆里为你挑歌。</Txt>
      </View>

      {!result ? (
        <>
          <View style={styles.capture}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" testID="scene-photo" />
            ) : (
              <LinearGradient
                colors={['rgba(160,139,255,0.18)', 'rgba(92,200,255,0.08)', 'rgba(18,21,29,1)']}
                style={StyleSheet.absoluteFill}
              />
            )}
            {busy ? <Scanning /> : null}
            {!photo && !busy ? (
              <View style={styles.captureEmpty}>
                <View style={styles.captureIcon}>
                  <Ionicons name="camera" size={28} color={colors.text} />
                </View>
                <Text style={styles.captureTitle}>拍下此刻</Text>
                <Text style={styles.captureSub}>光线、色彩、人群……AI 会从画面里读出氛围</Text>
              </View>
            ) : null}
            <View style={styles.captureBtns}>
              {Platform.OS !== 'web' ? (
                <Button label="拍照" icon="camera" variant="subtle" size="sm" onPress={() => choose('camera')} disabled={busy} />
              ) : null}
              <Button
                label={photo ? '换一张' : '选一张照片'}
                icon="images"
                variant="subtle"
                size="sm"
                onPress={() => choose('library')}
                disabled={busy}
                testID="scene-pick"
              />
              {photo ? (
                <Button label="不用照片" icon="close" variant="subtle" size="sm" onPress={() => setPhoto(null)} disabled={busy} />
              ) : null}
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="此刻……（可选，例如：下班路过江边，晚霞很好看）"
              placeholderTextColor={colors.faint}
              style={styles.input}
              maxLength={200}
              multiline
              testID="scene-text"
            />
            <View style={styles.wrap}>
              {PROMPTS.map((p) => (
                <Chip
                  key={p}
                  label={p}
                  selected={text.includes(p)}
                  color={colors.violet}
                  onPress={() => setText((t) => (t.includes(p) ? t.replace(p, '').replace(/^，|，$/g, '') : t ? `${t}，${p}` : p))}
                />
              ))}
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            label={busy ? '正在读懂此刻…' : '读懂此刻，为我挑歌'}
            icon="sparkles"
            variant="aurora"
            size="lg"
            loading={busy}
            onPress={analyze}
            testID="scene-go"
          />
          <Txt v="caption" style={{ textAlign: 'center' }}>
            不拍照也可以：AI 会根据此刻的时间、你所在的地点和一句话来理解氛围
          </Txt>
        </>
      ) : (
        <>
          <SceneCard result={result} photoUri={photo?.uri ?? null} />

          {result.coldStart ? (
            <View style={styles.cold} testID="cold-start">
              <Ionicons name="leaf" size={16} color={colors.lime} />
              <Text style={styles.coldText}>附近还没有人留下过歌。AI 先为你挑了这些——把喜欢的那首留在这里，你就是第一个。</Text>
            </View>
          ) : null}

          <View style={{ gap: 4 }}>
            <SectionHeader
              title="为此刻挑的歌"
              subtitle={result.coldStart ? '全部来自 AI' : '先听这里的人群记忆，再加上 AI 的新发现'}
            />
            {result.picks.map((p, i) =>
              p.source === 'crowd' ? (
                <View key={p.placeSong.id} testID="pick-crowd">
                  <SongRow
                    item={p.placeSong}
                    userId={user!.id}
                    reason={p.reason}
                    moods={p.matched}
                    place={p.place}
                    rank={i + 1}
                    onChange={patchCrowd}
                    onPressPlace={() => router.push(`/place/${p.place.id}`)}
                  />
                </View>
              ) : (
                <AiPick
                  key={`${p.song.title}|${p.song.artist}`}
                  rank={i + 1}
                  title={p.song.title}
                  artist={p.song.artist}
                  reason={p.reason}
                  matched={p.matched}
                  canKeep={!!result.place}
                  kept={!!added[`${p.song.title}|${p.song.artist}`]}
                  onKeep={() => keep(p.song.title, p.song.artist, p.reason)}
                />
              ),
            )}
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="再听一次" icon="refresh" variant="ghost" onPress={reset} style={{ flex: 1 }} testID="scene-again" />
            {result.place && result.picks[0] ? (
              <Button
                label="做成明信片"
                icon="image"
                variant="subtle"
                style={{ flex: 1 }}
                onPress={() => {
                  const first = result.picks[0]!;
                  const song = first.source === 'crowd' ? first.placeSong.song : first.song;
                  setPostcard({ place: result.place!, song, nickname: user!.nickname });
                }}
                testID="scene-postcard"
              />
            ) : null}
          </View>
        </>
      )}
      <PostcardSheet data={postcard} onClose={() => setPostcard(null)} />
    </Screen>
  );
}

/** 分析中：一条扫描线在画面上来回，配合逐步出现的提示。 */
function Scanning() {
  const y = useRef(new Animated.Value(0)).current;
  const [step, setStep] = useState(0);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(y, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 700);
    return () => {
      loop.stop();
      clearInterval(t);
    };
  }, [y]);
  const translateY = y.interpolate({ inputRange: [0, 1], outputRange: [0, 236] });
  return (
    <View style={StyleSheet.absoluteFill} testID="scanning">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(7,8,12,0.45)' }]} />
      <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]}>
        <LinearGradient colors={['rgba(62,230,193,0)', 'rgba(62,230,193,0.55)', 'rgba(62,230,193,0)']} style={{ flex: 1 }} />
      </Animated.View>
      <View style={styles.scanText}>
        <Ionicons name="sparkles" size={14} color={colors.mint} />
        <Text style={styles.scanLabel}>{STEPS[step]}</Text>
      </View>
    </View>
  );
}

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={styles.meterLabel}>{label}</Text>
        <Text style={styles.meterValue}>{Math.round(value * 100)}</Text>
      </View>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${Math.max(4, value * 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

/** AI 对此刻的理解。 */
function SceneCard({ result, photoUri }: { result: SceneResult; photoUri: string | null }) {
  const { scene, engine, place } = result;
  const c1 = moodColor[scene.moods[0] ?? ''] ?? colors.violet;
  const c2 = moodColor[scene.moods[1] ?? ''] ?? colors.sky;
  return (
    <View style={styles.scene} testID="scene-card">
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <LinearGradient colors={[`${c1}66`, `${c2}33`, colors.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      <LinearGradient colors={['rgba(7,8,12,0.25)', 'rgba(7,8,12,0.75)', 'rgba(7,8,12,0.96)']} style={StyleSheet.absoluteFill} />
      <View style={styles.sceneBody}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <AIBadge label={engine.kind === 'llm' ? `${engine.label} · 读懂此刻` : 'AI 读懂此刻'} testID="engine-badge" />
          <Pill label={scene.timeLabel} icon="time" color="#ffffff" />
        </View>
        <Text style={styles.sceneSummary} testID="scene-summary">
          {scene.summary}
        </Text>
        <View style={styles.wrap}>
          {scene.moods.map((m) => (
            <MoodChip key={m} mood={m} />
          ))}
          {scene.tags
            .filter((t) => t !== scene.timeLabel && t !== place?.name)
            .map((t) => (
              <Pill key={t} label={t} color="#ffffff" />
            ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <Meter label="能量" value={scene.energy} color={colors.sunset} />
          <Meter label="明亮" value={scene.valence} color={colors.lime} />
        </View>
        <View style={styles.sceneFoot}>
          <Ionicons name="location" size={12} color={colors.mint} />
          <Text style={styles.sceneFootText}>{place ? `你在「${place.name}」` : '你在一个还没有名字的地方'}</Text>
          <Text style={styles.engine}>
            {engine.kind === 'llm' ? `由${engine.label}理解` : '本地规则引擎（未接入大模型）'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function AiPick({
  rank,
  title,
  artist,
  reason,
  matched,
  canKeep,
  kept,
  onKeep,
}: {
  rank: number;
  title: string;
  artist: string;
  reason: string;
  matched: string[];
  canKeep: boolean;
  kept: boolean;
  onKeep: () => void;
}) {
  return (
    <View style={styles.aiPick} testID="pick-ai">
      <View style={styles.aiRow}>
        <Text style={styles.rank}>{rank}</Text>
        <Artwork title={title} artist={artist} size={50} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.aiTitle} numberOfLines={1} testID="pick-ai-title">
            {title}
          </Text>
          <Text style={styles.aiArtist} numberOfLines={1}>
            {artist}
          </Text>
        </View>
        <Pressable
          onPress={() => void Linking.openURL(qqMusicUrl({ title, artist }))}
          style={styles.play}
          accessibilityRole="button"
          accessibilityLabel="在QQ音乐听"
        >
          <Ionicons name="play" size={15} color={colors.ink} />
        </Pressable>
      </View>
      <View style={styles.aiMeta}>
        <AIBadge label="AI 新发现" />
        {matched.slice(0, 2).map((m) => (
          <MoodChip key={m} mood={m} size="sm" />
        ))}
      </View>
      <Text style={styles.aiReason}>{reason}</Text>
      {canKeep ? (
        <Button
          label={kept ? '已留在这里' : '把它留在这里'}
          icon={kept ? 'checkmark' : 'pin'}
          variant="subtle"
          size="sm"
          disabled={kept}
          onPress={onKeep}
          style={{ alignSelf: 'flex-start' }}
          testID="pick-keep"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  capture: {
    height: 260,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(160,139,255,0.35)',
  },
  captureEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 40 },
  captureIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  captureTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  captureSub: { color: colors.sub, fontSize: 12 },
  captureBtns: { position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', gap: 8, justifyContent: 'center' },
  scanLine: { position: 'absolute', left: 0, right: 0, top: 0, height: 24 },
  scanText: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(7,8,12,0.75)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  scanLabel: { color: colors.text, fontSize: 13, fontWeight: '700' },
  input: {
    minHeight: 64,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.text,
    fontSize: 15,
    padding: 14,
    textAlignVertical: 'top',
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { color: colors.red, fontSize: 13 },
  scene: { borderRadius: radius.xl, overflow: 'hidden', minHeight: 300, borderWidth: 1, borderColor: 'rgba(160,139,255,0.35)' },
  sceneBody: { padding: 18, gap: 14, marginTop: 'auto' },
  sceneSummary: { color: '#fff', fontSize: 22, lineHeight: 32, fontWeight: '800' },
  meterLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '800' },
  meterValue: { color: '#fff', fontSize: 11, fontWeight: '800' },
  meterTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3 },
  sceneFoot: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  sceneFootText: { color: colors.mint, fontSize: 12, fontWeight: '700' },
  engine: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginLeft: 'auto' },
  cold: {
    flexDirection: 'row',
    gap: 8,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(183,243,107,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(183,243,107,0.3)',
  },
  coldText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19 },
  aiPick: {
    gap: 8,
    padding: 14,
    marginVertical: 6,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(160,139,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(160,139,255,0.25)',
  },
  aiRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rank: { width: 18, color: colors.faint, fontSize: 15, fontWeight: '900', textAlign: 'center' },
  aiTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  aiArtist: { color: colors.sub, fontSize: 13 },
  aiMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 30 },
  aiReason: { color: colors.sub, fontSize: 12, lineHeight: 18, paddingLeft: 30 },
  play: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
});

