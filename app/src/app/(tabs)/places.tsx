import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { LocationGate } from '../../components/LocationGate';
import { PlaceCard } from '../../components/PlaceCard';
import { Radar } from '../../components/Radar';
import { Button, Card, Chip, EmptyState, ErrorState, Loading, Screen, SectionHeader, Txt } from '../../components/ui';
import { api } from '../../lib/api';
import { useLocation, type Coords } from '../../lib/location';
import { colors } from '../../lib/theme';
import { useAsync } from '../../lib/useAsync';

export default function PlacesTab() {
  return <LocationGate>{(coords) => <Places coords={coords} />}</LocationGate>;
}

const RANGES = [300, 500, 1000, 1500] as const;

function Places({ coords }: { coords: Coords }) {
  const router = useRouter();
  const { refresh } = useLocation();
  const [range, setRange] = useState<(typeof RANGES)[number] | null>(null);
  const key = `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`;
  const list = useAsync(() => api.nearby(coords, 1500), [key]);

  // 默认用能装下所有地点的最小量程，点不会挤在中心
  useEffect(() => {
    if (range !== null || !list.data) return;
    const far = Math.max(0, ...list.data.places.map((p) => p.distanceM ?? 0));
    setRange(RANGES.find((r) => r >= far * 1.15) ?? 1500);
  }, [list.data, range]);

  if (!list.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : <Loading />}
      </View>
    );
  }
  const r = range ?? 1500;
  const places = list.data.places.filter((p) => (p.distanceM ?? 0) <= r);

  return (
    <Screen
      glow={colors.mint}
      refreshing={list.loading}
      onRefresh={async () => {
        await refresh();
        await list.reload();
      }}
    >
      <View style={{ gap: 6 }}>
        <Txt v="display">附近的声景</Txt>
        <Txt v="sub">每个点都是一个有歌的地方。走近它，打卡，听听那里的人留下了什么。</Txt>
      </View>

      <Card style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {RANGES.map((x) => (
            <Chip key={x} label={x >= 1000 ? `${x / 1000} 公里` : `${x} 米`} selected={r === x} onPress={() => setRange(x)} />
          ))}
        </View>
        <Radar center={coords} places={places} rangeM={r} onPick={(p) => router.push(`/place/${p.id}`)} />
        <Txt v="caption" style={{ textAlign: 'center' }}>
          点的大小 = 留下的歌的数量 · 颜色 = 最受欢迎的那首是应景 / 常听 / 现场
        </Txt>
      </Card>

      <SectionHeader title={`${places.length} 个地点`} subtitle="按距离排序" />
      {places.length === 0 ? (
        <EmptyState
          icon="map-outline"
          title="这个范围内还没有地点"
          message="分享第一首歌时会自动为这里建一个地点。"
          action={<Button label="去分享" icon="add" onPress={() => router.push('/add')} />}
        />
      ) : (
        <View style={{ gap: 14 }}>
          {places.map((p) => (
            <PlaceCard key={p.id} place={p} onPress={() => router.push(`/place/${p.id}`)} />
          ))}
        </View>
      )}
    </Screen>
  );
}
