import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LocationGate } from '../../components/LocationGate';
import { PlaceCard } from '../../components/PlaceCard';
import { PlaceCover } from '../../components/PlaceCover';
import { SongCard } from '../../components/SongCard';
import { Button, Card, EmptyState, ErrorState, Loading, Muted, Screen, SectionTitle, Title } from '../../components/ui';
import { api, type DiscoverResult, type PlaceSong } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDistance } from '../../lib/format';
import { useLocation, type Coords } from '../../lib/location';
import { colors } from '../../lib/theme';
import { useAsync } from '../../lib/useAsync';

export default function DiscoverTab() {
  return <LocationGate>{(coords) => <Discover coords={coords} />}</LocationGate>;
}

function Discover({ coords }: { coords: Coords }) {
  const router = useRouter();
  const { user } = useAuth();
  const { refresh, isDemo } = useLocation();
  const [shuffling, setShuffling] = useState(false);
  // 坐标精确到 ~10 米作为依赖，避免 GPS 微小抖动触发重复请求
  const key = `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`;
  const disc = useAsync<DiscoverResult>(() => api.discover(coords, 5), [key]);

  const reshuffle = async () => {
    setShuffling(true);
    await disc.reload();
    setShuffling(false);
  };
  const pull = async () => {
    await refresh();
    await disc.reload();
  };

  const patch = (next: PlaceSong) =>
    disc.setData((d) =>
      d && {
        ...d,
        recommendations: d.recommendations.map((r) => (r.placeSong.id === next.id ? { ...r, placeSong: next } : r)),
      },
    );
  const drop = (id: string) =>
    disc.setData((d) => d && { ...d, recommendations: d.recommendations.filter((r) => r.placeSong.id !== id) });

  if (!disc.data) {
    return disc.error ? <ErrorState message={disc.error} onRetry={disc.reload} /> : <Loading label="正在寻找这里的音乐…" />;
  }
  const { currentPlace, nearbyPlaces, recommendations } = disc.data;

  return (
    <Screen onRefresh={pull} refreshing={disc.loading && !shuffling}>
      <Title>此刻，这里</Title>
      {isDemo ? <Muted>正在使用示例位置（上海外滩）。在手机上授权定位后会显示你身边的地点。</Muted> : null}

      {currentPlace ? (
        <Card style={styles.here}>
          <PlaceCover place={currentPlace} height={170}>
            <Text style={styles.hereLabel}>你正在</Text>
            <Text style={styles.hereName} testID="current-place">{currentPlace.name}</Text>
            <Text style={styles.hereMeta}>
              {currentPlace.songCount} 首歌 · {currentPlace.visitorCount} 人来过
            </Text>
          </PlaceCover>
          <View style={{ padding: 14 }}>
            <Button
              label="查看并打卡"
              icon="flag"
              onPress={() => router.push(`/place/${currentPlace.id}`)}
              testID="go-checkin"
            />
          </View>
        </Card>
      ) : (
        <Card>
          <Text style={styles.hereName}>这里还没有被标记的地点</Text>
          <Muted>
            {nearbyPlaces.length > 0
              ? `${formatDistance(nearbyPlaces[0]!.distanceM)}外有「${nearbyPlaces[0]!.name}」。也可以把你现在的位置变成新地点。`
              : '成为第一个在这里留下歌的人，让路过的人听见你的推荐。'}
          </Muted>
          <Button label="在这里分享一首歌" icon="add" onPress={() => router.push('/add')} />
        </Card>
      )}

      <SectionTitle
        right={
          recommendations.length > 0 ? (
            <Button label="换一批" icon="shuffle" variant="ghost" small loading={shuffling} onPress={reshuffle} testID="shuffle" />
          ) : undefined
        }
      >
        在这里，别人听过的
      </SectionTitle>

      {recommendations.length === 0 ? (
        <EmptyState
          title="附近暂时没有可推荐的歌"
          message="还没有人在这附近留下推荐，或者你已经看过所有的了。"
        />
      ) : (
        recommendations.map((r) => (
          <SongCard
            key={r.placeSong.id}
            item={r.placeSong}
            userId={user!.id}
            place={r.place}
            onChange={patch}
            onDeleted={drop}
            onPressPlace={() => router.push(`/place/${r.place.id}`)}
          />
        ))
      )}

      {nearbyPlaces.length > 0 && (
        <>
          <SectionTitle>附近的地点</SectionTitle>
          {nearbyPlaces.slice(0, 3).map((p) => (
            <PlaceCard key={p.id} place={p} onPress={() => router.push(`/place/${p.id}`)} />
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  here: { borderColor: colors.accent, padding: 0, gap: 0, overflow: 'hidden' },
  hereMeta: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  hereLabel: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  hereName: { color: '#fff', fontSize: 26, fontWeight: '900' },
});
