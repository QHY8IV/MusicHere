import { useRouter } from 'expo-router';
import { LocationGate } from '../../components/LocationGate';
import { PlaceCard } from '../../components/PlaceCard';
import { Button, EmptyState, ErrorState, Loading, Muted, Screen, Title } from '../../components/ui';
import { api } from '../../lib/api';
import { useLocation, type Coords } from '../../lib/location';
import { useAsync } from '../../lib/useAsync';

export default function PlacesTab() {
  return <LocationGate>{(coords) => <Places coords={coords} />}</LocationGate>;
}

function Places({ coords }: { coords: Coords }) {
  const router = useRouter();
  const { refresh } = useLocation();
  const key = `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`;
  const list = useAsync(() => api.nearby(coords, 1500), [key]);

  if (!list.data) {
    return list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : <Loading />;
  }
  const places = list.data.places;

  return (
    <Screen
      refreshing={list.loading}
      onRefresh={async () => {
        await refresh();
        await list.reload();
      }}
    >
      <Title>附近的地点</Title>
      <Muted>1.5 公里内，按距离排序。到了现场就可以打卡。</Muted>
      {places.length === 0 ? (
        <EmptyState
          icon="location-outline"
          title="附近还没有地点"
          message="分享第一首歌时会自动为这里建一个地点。"
          action={<Button label="去分享" icon="add" onPress={() => router.push('/add')} />}
        />
      ) : (
        places.map((p) => <PlaceCard key={p.id} place={p} onPress={() => router.push(`/place/${p.id}`)} />)
      )}
    </Screen>
  );
}
