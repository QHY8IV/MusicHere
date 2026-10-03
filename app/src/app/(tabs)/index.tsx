import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/CommentItem';
import { LocationGate } from '../../components/LocationGate';
import { NowPlaying } from '../../components/NowPlaying';
import { PlaceCard } from '../../components/PlaceCard';
import { PlaceCover } from '../../components/PlaceCover';
import { SongRow } from '../../components/SongRow';
import {
  AIBadge,
  Button,
  EmptyState,
  ErrorState,
  Loading,
  MoodChip,
  Pill,
  Screen,
  SectionHeader,
  Txt,
} from '../../components/ui';
import { api, type DiscoverResult, type PlaceSong } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/feedback';
import { useLocation, type Coords } from '../../lib/location';
import { colors, gradients, radius } from '../../lib/theme';
import { useAsync } from '../../lib/useAsync';

export default function NowTab() {
  return <LocationGate>{(coords) => <Now coords={coords} />}</LocationGate>;
}

function greeting(h: number) {
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 17) return '下午好';
  if (h < 19) return '傍晚好';
  return '晚上好';
}

function Now({ coords }: { coords: Coords }) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { refresh, isDemo } = useLocation();
  const [idx, setIdx] = useState(0);
  const key = `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`;
  const disc = useAsync<DiscoverResult>(() => api.discover(coords, 6), [key]);
  const here = disc.data?.currentPlace ?? null;
  const persona = useAsync(() => api.persona(here!.id), [here?.id], !!here);

  const patch = (next: PlaceSong) =>
    disc.setData(
      (d) => d && { ...d, recommendations: d.recommendations.map((r) => (r.placeSong.id === next.id ? { ...r, placeSong: next } : r)) },
    );
  const drop = (id: string) =>
    disc.setData((d) => d && { ...d, recommendations: d.recommendations.filter((r) => r.placeSong.id !== id) });

  if (!disc.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        {disc.error ? <ErrorState message={disc.error} onRetry={disc.reload} /> : <Loading label="正在聆听这里…" />}
      </View>
    );
  }

  const { nearbyPlaces, recommendations, waitingBottles } = disc.data;
  const now = recommendations[idx % Math.max(1, recommendations.length)];
  const hour = new Date().getHours();

  const next = async () => {
    if (idx + 1 < recommendations.length) setIdx(idx + 1);
    else {
      setIdx(0);
      await disc.reload();
    }
  };
  const likeNow = async () => {
    if (!now) return;
    try {
      const v = now.placeSong.myVote === 1 ? 0 : 1;
      patch((await api.vote(now.placeSong.id, v)).placeSong);
      if (v === 1) toast.show('已点赞，它在这里的推荐权重提高了');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '操作失败', 'error');
    }
  };

  return (
    <Screen testID="screen-now"
      onRefresh={async () => {
        await refresh();
        await disc.reload();
      }}
      refreshing={disc.loading}
    >
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt v="display">
            {greeting(hour)}
            {user ? `，${user.nickname}` : ''}
          </Txt>
          <View style={styles.locRow}>
            <Ionicons name="navigate" size={13} color={colors.lime} />
            <Text style={styles.loc} numberOfLines={1}>
              {here ? here.name : nearbyPlaces[0] ? `${nearbyPlaces[0].name} 附近` : '一个还没有歌的地方'}
              {isDemo ? ' · 示例位置' : ''}
            </Text>
          </View>
        </View>
        <Pressable onPress={() => router.push('/me')} accessibilityLabel="我的">
          <Avatar name={user?.nickname ?? '?'} size={44} />
        </Pressable>
      </View>

      {here ? (
        <View style={styles.hero} testID="hero">
          <Pressable onPress={() => router.push(`/place/${here.id}`)} accessibilityRole="link" accessibilityLabel={`查看${here.name}`}>
          <PlaceCover
            place={here}
            height={320}
            topRight={
              waitingBottles > 0 ? (
                <View testID="bottle-teaser">
                  <Pill label={`${waitingBottles} 个漂流瓶等你拾起`} icon="mail" color="#F1DDB4" solid />
                </View>
              ) : undefined
            }
          >
            <Text style={styles.heroLabel}>你正在</Text>
            <Text style={styles.heroName} testID="current-place">
              {here.name}
            </Text>
            {persona.data ? (
              <>
                <Text style={styles.heroSummary} numberOfLines={2}>
                  {persona.data.persona.summary}
                </Text>
                <View style={styles.wrap}>
                  {persona.data.persona.moods.slice(0, 3).map((m) => (
                    <MoodChip key={m.mood} mood={m.mood} size="sm" />
                  ))}
                </View>
              </>
            ) : (
              <Text style={styles.heroSummary}>
                {here.songCount} 首歌 · {here.visitorCount} 人来过
              </Text>
            )}
          </PlaceCover>
          </Pressable>
          <View style={styles.heroBar}>
            <Button label="打卡，听这里的歌" icon="flag" onPress={() => router.push(`/place/${here.id}`)} testID="go-checkin" style={{ flex: 1 }} />
            <Button label="共鸣" icon="pulse" variant="aurora" onPress={() => router.push('/resonance')} testID="go-resonance" />
          </View>
        </View>
      ) : (
        <View style={styles.emptyHero}>
          <LinearGradient colors={['rgba(160,139,255,0.22)', 'rgba(62,230,193,0.08)']} style={StyleSheet.absoluteFill} />
          <Txt v="h2">这里还没有被标记</Txt>
          <Txt v="sub">
            {nearbyPlaces.length > 0
              ? `附近有「${nearbyPlaces[0]!.name}」。也可以让 AI 先读懂这里，为你挑第一首歌。`
              : '你可能是第一个在这里听歌的人。让 AI 先读懂这里，再把第一首歌留下。'}
          </Txt>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="AI 听这里" icon="scan" variant="aurora" onPress={() => router.push('/listen')} style={{ flex: 1 }} />
            <Button label="留下第一首" icon="add" variant="ghost" onPress={() => router.push('/add')} style={{ flex: 1 }} />
          </View>
        </View>
      )}

      <Pressable onPress={() => router.push('/listen')} style={styles.aiCta} testID="ai-cta" accessibilityRole="button">
        <LinearGradient colors={[...gradients.aurora]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.aiIcon}>
          <Ionicons name="scan" size={22} color={colors.ink} />
        </LinearGradient>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.aiTitle}>拍一下，听这里</Text>
            <AIBadge />
          </View>
          <Text style={styles.aiSub}>AI 读懂此刻的光线与心情，结合这里的人群记忆为你挑歌</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.sub} />
      </Pressable>

      {now ? (
        <NowPlaying
          rec={now}
          index={idx % recommendations.length}
          total={recommendations.length}
          onNext={next}
          onLike={likeNow}
          onPressPlace={() => router.push(`/place/${now.place.id}`)}
        />
      ) : (
        <EmptyState title="附近暂时没有可推荐的歌" message="还没有人在这附近留下推荐。试试「听这里」，让 AI 先为你挑。" />
      )}

      {recommendations.length > 1 ? (
        <View style={{ gap: 4 }}>
          <SectionHeader title="此地记忆" subtitle="前人在这附近留下、常听、现场听到的歌" />
          {recommendations
            .filter((_, i) => i !== idx % recommendations.length)
            .map((r) => (
              <SongRow
                key={r.placeSong.id}
                item={r.placeSong}
                userId={user!.id}
                reason={r.reason}
                place={r.place}
                onChange={patch}
                onDeleted={drop}
                onPressPlace={() => router.push(`/place/${r.place.id}`)}
              />
            ))}
        </View>
      ) : null}

      {nearbyPlaces.length > 0 ? (
        <View style={{ gap: 12 }}>
          <SectionHeader
            title="附近的地点"
            right={<Button label="全部" variant="subtle" size="sm" onPress={() => router.push('/places')} />}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 18 }}>
            {nearbyPlaces.map((p) => (
              <PlaceCard key={p.id} place={p} compact onPress={() => router.push(`/place/${p.id}`)} />
            ))}
          </ScrollView>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  loc: { color: colors.sub, fontSize: 14, fontWeight: '700', flex: 1 },
  hero: { borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  heroLabel: { color: colors.lime, fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  heroName: { color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: -0.5 },
  heroSummary: { color: 'rgba(255,255,255,0.86)', fontSize: 14, lineHeight: 21 },
  heroBar: { padding: 14, flexDirection: 'row', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  emptyHero: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(160,139,255,0.3)',
    padding: 20,
    gap: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  aiCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(160,139,255,0.35)',
  },
  aiIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  aiTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  aiSub: { color: colors.sub, fontSize: 12, lineHeight: 17 },
});
