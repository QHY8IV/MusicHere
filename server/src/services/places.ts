import { randomUUID } from 'node:crypto';
import { boundingBox, haversineM } from '../geo.ts';
import { HttpError, notFound, row, rows, type Deps } from '../http.ts';
import { listPlaceSongs, type PlaceSongDto } from './placeSongs.ts';

export const CATEGORIES = [
  'street',
  'park',
  'cafe',
  'station',
  'campus',
  'shop',
  'venue',
  'landmark',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

interface PlaceRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  lat: number;
  lng: number;
  radius_m: number;
  created_at: string;
}

export interface PlaceDto {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  lat: number;
  lng: number;
  radiusM: number;
  createdAt: string;
  distanceM: number | null;
  songCount: number;
  visitorCount: number;
  commentCount: number;
  /** 该地点当前权重最高的一首歌，用于列表预览 */
  topSong: { title: string; artist: string; kind: string } | null;
}

export const DEFAULT_RADIUS_M = 150;

function toDto(
  p: PlaceRow,
  counts: { songs: number; visitors: number; comments: number },
  top: PlaceSongDto | undefined,
  distanceM: number | null,
): PlaceDto {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    lat: p.lat,
    lng: p.lng,
    radiusM: p.radius_m,
    createdAt: p.created_at,
    distanceM: distanceM === null ? null : Math.round(distanceM),
    songCount: counts.songs,
    visitorCount: counts.visitors,
    commentCount: counts.comments,
    topSong: top ? { title: top.song.title, artist: top.song.artist, kind: top.kind } : null,
  };
}

interface CountRow {
  place_id: string;
  n: number;
}

function countsFor(deps: Deps, ids: string[]) {
  const empty = () => new Map<string, number>();
  if (ids.length === 0) return { songs: empty(), visitors: empty(), comments: empty() };
  const marks = ids.map(() => '?').join(',');
  const grouped = (sql: string) =>
    new Map(rows<CountRow>(deps.db.prepare(sql).all(...ids)).map((r) => [r.place_id, r.n]));
  return {
    songs: grouped(
      `SELECT place_id, COUNT(*) AS n FROM place_songs WHERE place_id IN (${marks}) GROUP BY place_id`,
    ),
    visitors: grouped(
      `SELECT place_id, COUNT(DISTINCT user_id) AS n FROM checkins WHERE place_id IN (${marks}) GROUP BY place_id`,
    ),
    comments: grouped(
      `SELECT place_id, COUNT(*) AS n FROM comments WHERE place_id IN (${marks}) GROUP BY place_id`,
    ),
  };
}

function buildDtos(
  deps: Deps,
  places: { place: PlaceRow; distanceM: number | null }[],
  userId: string | null,
): PlaceDto[] {
  const ids = places.map((p) => p.place.id);
  const counts = countsFor(deps, ids);
  const songs = listPlaceSongs(deps, { placeIds: ids, userId });
  const topByPlace = new Map<string, PlaceSongDto>();
  for (const s of songs) {
    // listPlaceSongs 已按权重降序，第一次见到的就是最高的
    if (!topByPlace.has(s.placeId)) topByPlace.set(s.placeId, s);
  }
  return places.map(({ place, distanceM }) =>
    toDto(
      place,
      {
        songs: counts.songs.get(place.id) ?? 0,
        visitors: counts.visitors.get(place.id) ?? 0,
        comments: counts.comments.get(place.id) ?? 0,
      },
      topByPlace.get(place.id),
      distanceM,
    ),
  );
}

export function getPlaceRow(deps: Deps, id: string): PlaceRow {
  const place = row<PlaceRow>(deps.db.prepare('SELECT * FROM places WHERE id = ?').get(id));
  if (!place) throw notFound('地点');
  return place;
}

export function getPlace(
  deps: Deps,
  id: string,
  viewer: { userId: string | null; lat?: number; lng?: number },
): PlaceDto {
  const place = getPlaceRow(deps, id);
  const distanceM =
    viewer.lat !== undefined && viewer.lng !== undefined
      ? haversineM(viewer.lat, viewer.lng, place.lat, place.lng)
      : null;
  return buildDtos(deps, [{ place, distanceM }], viewer.userId)[0]!;
}

/** 某点周围 radiusM 米内的地点，按距离升序。 */
export function placesNear(
  deps: Deps,
  lat: number,
  lng: number,
  radiusM: number,
  limit: number,
  userId: string | null,
): PlaceDto[] {
  const box = boundingBox(lat, lng, radiusM);
  const candidates = rows<PlaceRow>(
    deps.db
      .prepare('SELECT * FROM places WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?')
      .all(box.minLat, box.maxLat, box.minLng, box.maxLng),
  )
    .map((place) => ({ place, distanceM: haversineM(lat, lng, place.lat, place.lng) }))
    .filter((c) => c.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
  return buildDtos(deps, candidates, userId);
}

/** 半径内所有候选地点的原始行（发现页用，不拼 DTO）。 */
export function placeRowsNear(
  deps: Deps,
  lat: number,
  lng: number,
  radiusM: number,
): { place: PlaceRow; distanceM: number }[] {
  const box = boundingBox(lat, lng, radiusM);
  return rows<PlaceRow>(
    deps.db
      .prepare('SELECT * FROM places WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?')
      .all(box.minLat, box.maxLat, box.minLng, box.maxLng),
  )
    .map((place) => ({ place, distanceM: haversineM(lat, lng, place.lat, place.lng) }))
    .filter((c) => c.distanceM <= radiusM);
}

export interface CreatePlaceInput {
  name: string;
  lat: number;
  lng: number;
  description?: string | undefined;
  category?: Category | undefined;
  radiusM?: number | undefined;
}

const normName = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * 新建地点。200 米内已有同名地点时直接返回已有的，避免同一个地方被不同人反复新建。
 */
export function createPlace(
  deps: Deps,
  userId: string | null,
  input: CreatePlaceInput,
): { place: PlaceDto; created: boolean } {
  const existing = placeRowsNear(deps, input.lat, input.lng, 200).find(
    (c) => normName(c.place.name) === normName(input.name),
  );
  if (existing) {
    return { place: getPlace(deps, existing.place.id, { userId }), created: false };
  }
  const id = randomUUID();
  deps.db
    .prepare(
      `INSERT INTO places (id, name, description, category, lat, lng, radius_m, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.description ?? null,
      input.category ?? null,
      input.lat,
      input.lng,
      input.radiusM ?? DEFAULT_RADIUS_M,
      userId,
      deps.now().toISOString(),
    );
  return { place: getPlace(deps, id, { userId }), created: true };
}

/** 打卡允许的误差：在地点半径基础上再放宽 50 米，兼顾 GPS 漂移。 */
export function checkinAllowanceM(radiusM: number): number {
  return Math.max(radiusM, 100) + 50;
}

const REPEAT_CHECKIN_WINDOW_MS = 6 * 3_600_000;

interface CheckinRow {
  id: string;
  user_id: string;
  place_id: string;
  distance_m: number;
  note: string | null;
  created_at: string;
}

export interface CheckinDto {
  id: string;
  placeId: string;
  distanceM: number;
  note: string | null;
  createdAt: string;
}

const checkinDto = (r: CheckinRow): CheckinDto => ({
  id: r.id,
  placeId: r.place_id,
  distanceM: Math.round(r.distance_m),
  note: r.note,
  createdAt: r.created_at,
});

/**
 * 打卡。必须在地点附近；同一用户 6 小时内重复打卡同一地点只记一次，返回已有记录。
 */
export function checkIn(
  deps: Deps,
  userId: string,
  placeId: string,
  lat: number,
  lng: number,
  note: string | undefined,
): { checkin: CheckinDto; repeat: boolean; firstVisit: boolean } {
  const place = getPlaceRow(deps, placeId);
  const distanceM = haversineM(lat, lng, place.lat, place.lng);
  const allowed = checkinAllowanceM(place.radius_m);
  if (distanceM > allowed) {
    throw new HttpError(403, 'too_far', '距离该地点太远，无法打卡', {
      distanceM: Math.round(distanceM),
      allowedM: allowed,
    });
  }

  const now = deps.now();
  const previous = rows<CheckinRow>(
    deps.db
      .prepare('SELECT * FROM checkins WHERE user_id = ? AND place_id = ? ORDER BY created_at DESC')
      .all(userId, placeId),
  );
  const latest = previous[0];
  if (latest && now.getTime() - new Date(latest.created_at).getTime() < REPEAT_CHECKIN_WINDOW_MS) {
    return { checkin: checkinDto(latest), repeat: true, firstVisit: false };
  }

  const id = randomUUID();
  deps.db
    .prepare(
      `INSERT INTO checkins (id, user_id, place_id, lat, lng, distance_m, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, placeId, lat, lng, distanceM, note ?? null, now.toISOString());
  const created = row<CheckinRow>(deps.db.prepare('SELECT * FROM checkins WHERE id = ?').get(id))!;
  return { checkin: checkinDto(created), repeat: false, firstVisit: previous.length === 0 };
}

export function visitorCount(deps: Deps, placeId: string): number {
  const r = row<{ n: number }>(
    deps.db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM checkins WHERE place_id = ?').get(placeId),
  );
  return r?.n ?? 0;
}

export function myCheckins(
  deps: Deps,
  userId: string,
  limit: number,
): (CheckinDto & { placeName: string })[] {
  return rows<CheckinRow & { place_name: string }>(
    deps.db
      .prepare(
        `SELECT c.*, p.name AS place_name FROM checkins c JOIN places p ON p.id = c.place_id
         WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT ?`,
      )
      .all(userId, limit),
  ).map((r) => ({ ...checkinDto(r), placeName: r.place_name }));
}
