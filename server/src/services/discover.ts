import { isSuppressed, proximityFactor, weightedSample } from '../ranking.ts';
import type { Deps } from '../http.ts';
import { placeRowsNear, placesNear, type PlaceDto } from './places.ts';
import { listPlaceSongs, type PlaceSongDto } from './placeSongs.ts';

export interface Recommendation {
  placeSong: PlaceSongDto;
  place: { id: string; name: string; distanceM: number };
}

export interface DiscoverResult {
  /** 用户当前所在的地点（落在某地点半径内时），否则为 null */
  currentPlace: PlaceDto | null;
  nearbyPlaces: PlaceDto[];
  recommendations: Recommendation[];
}

/**
 * 发现页：按定位随机推荐「之前的人推荐的歌 / 常听的歌 / 在这里听到过的歌」。
 *
 * 候选 = 半径内所有地点的所有记录。每条记录的抽样权重 = 推荐权重 × 距离衰减，
 * 再做加权无放回抽样，所以：点赞多、官方、近的更容易被抽到，但每次刷新结果都不同。
 * 过滤掉：自己上传的、自己点过踩的、明显不受欢迎的；同一首歌只会出现一次。
 */
export function discover(
  deps: Deps,
  userId: string,
  lat: number,
  lng: number,
  opts: { radiusM: number; limit: number },
): DiscoverResult {
  const near = placeRowsNear(deps, lat, lng, opts.radiusM);
  const distanceByPlace = new Map(near.map((n) => [n.place.id, n]));

  const candidates = listPlaceSongs(deps, {
    placeIds: near.map((n) => n.place.id),
    userId,
  }).filter(
    (s) => s.submittedBy?.id !== userId && s.myVote !== -1 && !isSuppressed(s.likes, s.dislikes),
  );

  // 同一首歌在多个地点/多种关系下出现时，只保留抽样权重最高的一条
  const best = new Map<string, { item: PlaceSongDto; weight: number }>();
  for (const s of candidates) {
    const n = distanceByPlace.get(s.placeId)!;
    const weight = s.weight * proximityFactor(n.distanceM, n.place.radius_m);
    const current = best.get(s.song.id);
    if (!current || weight > current.weight) best.set(s.song.id, { item: s, weight });
  }

  const picked = weightedSample([...best.values()], opts.limit, deps.rng);
  const recommendations = picked.map((placeSong) => {
    const n = distanceByPlace.get(placeSong.placeId)!;
    return {
      placeSong,
      place: { id: n.place.id, name: n.place.name, distanceM: Math.round(n.distanceM) },
    };
  });

  const nearbyPlaces = placesNear(deps, lat, lng, opts.radiusM, 8, userId);
  const currentPlace =
    nearbyPlaces.find((p) => p.distanceM !== null && p.distanceM <= p.radiusM) ?? null;

  return { currentPlace, nearbyPlaces, recommendations };
}
