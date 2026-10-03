import Constants from 'expo-constants';
import { Platform } from 'react-native';

// ---------- 类型（与服务端 DTO 保持一致） ----------

export type Kind = 'vibe' | 'frequent' | 'live';
export type EventType = 'concert' | 'improv' | 'busker' | 'other';
export type Category =
  | 'street'
  | 'park'
  | 'cafe'
  | 'station'
  | 'campus'
  | 'shop'
  | 'venue'
  | 'landmark'
  | 'other';

export interface User {
  id: string;
  nickname: string;
  createdAt: string;
}

export interface Stats {
  checkins: number;
  places: number;
  songs: number;
  comments: number;
  likesReceived: number;
}

export interface Place {
  id: string;
  name: string;
  description: string | null;
  category: Category | null;
  lat: number;
  lng: number;
  radiusM: number;
  /** 背景图路径（`/api/uploads/…` 或 http(s) 外链），没有则为 null */
  imageUrl: string | null;
  /** 当前用户能否设置/更换封面 */
  canSetImage: boolean;
  createdAt: string;
  distanceM: number | null;
  songCount: number;
  visitorCount: number;
  commentCount: number;
  topSong: { title: string; artist: string; kind: Kind } | null;
}

export interface PlaceSong {
  id: string;
  placeId: string;
  kind: Kind;
  source: 'user' | 'official';
  note: string | null;
  song: { id: string; title: string; artist: string; url: string | null };
  live: {
    eventType: EventType | null;
    performer: string | null;
    eventTitle: string | null;
    eventAt: string | null;
  } | null;
  submittedBy: { id: string; nickname: string } | null;
  createdAt: string;
  likes: number;
  dislikes: number;
  listeners: number;
  myVote: 1 | -1 | 0;
  listenedToday: boolean;
  weight: number;
}

export interface Comment {
  id: string;
  placeId: string;
  body: string;
  mood: string | null;
  author: { id: string; nickname: string };
  song: { placeSongId: string; title: string; artist: string } | null;
  likes: number;
  likedByMe: boolean;
  createdAt: string;
}

export interface Recommendation {
  placeSong: PlaceSong;
  place: { id: string; name: string; distanceM: number };
  moods: string[];
  reason: string;
}

export interface DiscoverResult {
  currentPlace: Place | null;
  nearbyPlaces: Place[];
  recommendations: Recommendation[];
  waitingBottles: number;
}

export interface Engine {
  kind: 'llm' | 'rules';
  label: string;
}

export interface Scene {
  summary: string;
  moods: string[];
  tags: string[];
  energy: number;
  valence: number;
  timeLabel: string;
}

export type ScenePick =
  | {
      source: 'crowd';
      placeSong: PlaceSong;
      place: { id: string; name: string; distanceM: number };
      matched: string[];
      reason: string;
    }
  | { source: 'ai'; song: { title: string; artist: string }; matched: string[]; reason: string };

export interface SceneResult {
  engine: Engine;
  scene: Scene;
  place: Place | null;
  picks: ScenePick[];
  coldStart: boolean;
}

export interface Persona {
  engine: Engine;
  summary: string;
  keywords: string[];
  moods: { mood: string; share: number }[];
  hours: number[];
  peak: { startHour: number; label: string } | null;
  topArtists: string[];
  counts: { songs: number; live: number; visitors: number; comments: number };
  generatedAt: string;
}

export interface Bottle {
  id: string;
  placeId: string;
  placeName: string;
  song: { title: string; artist: string; url: string | null };
  message: string;
  from: { id: string; nickname: string };
  createdAt: string;
  picked: { by: { id: string; nickname: string }; at: string } | null;
}

export interface ColorHint {
  brightness: number;
  warmth: number;
  saturation: number;
}

export interface Checkin {
  id: string;
  placeId: string;
  distanceM: number;
  note: string | null;
  createdAt: string;
}

export interface CheckinResult {
  checkin: Checkin;
  repeat: boolean;
  firstVisit: boolean;
  place: Place;
  visitorCount: number;
  songs: Record<Kind, PlaceSong[]>;
  bottle: Bottle | null;
  waitingBottles: number;
}

export interface NewPlaceSong {
  title: string;
  artist: string;
  kind: Kind;
  url?: string;
  note?: string;
  eventType?: EventType;
  performer?: string;
  eventTitle?: string;
  eventAt?: string;
}

// ---------- 客户端 ----------

/**
 * 解析后端地址：
 *  1. EXPO_PUBLIC_API_URL 显式指定（真机/线上）
 *  2. web 版部署在线上（非 localhost）时，用页面自身的 origin（由反向代理把 /api 转给后端）
 *  3. 开发服务器的 hostUri（Expo Go 扫码时就是开发机的局域网 IP）→ 同一台机器的 3000 端口
 *  4. Android 模拟器 10.0.2.2；其他情况 localhost
 */
export function apiBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const hostUri = Constants.expoConfig?.hostUri;
  if (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    !/^(localhost|127\.|\[::1\])/.test(window.location.hostname)
  ) {
    return window.location.origin;
  }
  if (hostUri && Platform.OS !== 'web') return `http://${hostUri.split(':')[0]}:3000`;
  if (Platform.OS === 'android') return 'http://10.0.2.2:3000';
  return 'http://localhost:3000';
}

export class ApiError extends Error {
  status: number;
  code: string;
  data: Record<string, unknown>;
  constructor(status: number, code: string, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setToken(t: string | null) {
  token = t;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api${path}`, {
      method,
      headers: {
        // FormData 不能手动设 content-type，否则会缺 multipart 的 boundary
        ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: isForm ? (body as FormData) : JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'network', `连不上服务器（${apiBase()}），请检查网络或后端是否已启动`);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? `请求失败（${res.status}）`, data);
  }
  return data as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};

type Pos = { lat: number; lng: number };

/** 把服务端返回的图片路径变成可直接给 <Image> 的地址。 */
export function imageUri(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith('/') ? `${apiBase()}${path}` : path;
}

export interface PickedImage {
  uri: string;
  mimeType: string;
  fileName: string;
}

async function uploadPlaceImage(placeId: string, img: PickedImage) {
  const form = new FormData();
  if (Platform.OS === 'web') {
    // web 上 uri 是 blob:/data: 地址，要先取成 Blob
    const blob = await (await fetch(img.uri)).blob();
    form.append('file', blob, img.fileName);
  } else {
    // React Native 的 FormData 接受 { uri, name, type }
    form.append('file', { uri: img.uri, name: img.fileName, type: img.mimeType } as unknown as Blob);
  }
  return request<{ place: Place }>('POST', `/places/${placeId}/image`, form);
}

export const api = {
  uploadPlaceImage,
  guest: (nickname: string) =>
    request<{ user: User; token: string }>('POST', '/auth/guest', { nickname }),
  me: () => request<{ user: User; stats: Stats }>('GET', '/me'),
  rename: (nickname: string) => request<{ user: User }>('PATCH', '/me', { nickname }),
  myCheckins: () =>
    request<{ checkins: (Checkin & { placeName: string })[] }>('GET', '/me/checkins'),
  mySongs: () => request<{ songs: (PlaceSong & { placeName: string })[] }>('GET', '/me/songs'),

  discover: (p: Pos, limit = 6) =>
    request<DiscoverResult>('GET', `/discover${qs({ lat: p.lat, lng: p.lng, limit, hour: new Date().getHours() })}`),
  nearby: (p: Pos, radius = 1000) =>
    request<{ places: Place[] }>('GET', `/places/nearby${qs({ lat: p.lat, lng: p.lng, radius })}`),
  place: (id: string, p?: Pos) =>
    request<{ place: Place }>('GET', `/places/${id}${qs({ lat: p?.lat, lng: p?.lng })}`),
  createPlace: (input: Pos & { name: string; category?: Category; description?: string }) =>
    request<{ place: Place; created: boolean }>('POST', '/places', input),
  checkin: (id: string, p: Pos, note?: string) =>
    request<CheckinResult>('POST', `/places/${id}/checkin`, { ...p, note }),

  songs: (placeId: string, kind?: Kind) =>
    request<{ songs: PlaceSong[] }>('GET', `/places/${placeId}/songs${qs({ kind })}`),
  addSong: (placeId: string, input: NewPlaceSong) =>
    request<{ placeSong: PlaceSong; created: boolean }>('POST', `/places/${placeId}/songs`, input),
  vote: (id: string, value: 1 | -1 | 0) =>
    request<{ placeSong: PlaceSong }>('PUT', `/place-songs/${id}/vote`, { value }),
  listen: (id: string) => request<{ placeSong: PlaceSong }>('POST', `/place-songs/${id}/listen`),
  deleteSong: (id: string) => request<void>('DELETE', `/place-songs/${id}`),

  comments: (placeId: string, before?: string) =>
    request<{ comments: Comment[]; nextBefore: string | null }>(
      'GET',
      `/places/${placeId}/comments${qs({ before })}`,
    ),
  addComment: (placeId: string, input: { body: string; mood?: string; placeSongId?: string }) =>
    request<{ comment: Comment }>('POST', `/places/${placeId}/comments`, input),
  likeComment: (id: string, liked: boolean) =>
    request<{ comment: Comment }>(liked ? 'PUT' : 'DELETE', `/comments/${id}/like`),
  deleteComment: (id: string) => request<void>('DELETE', `/comments/${id}`),

  aiStatus: () => request<{ engine: Engine }>('GET', '/ai/status'),
  scene: (input: Pos & { text?: string; image?: string; colorHint?: ColorHint }) =>
    request<SceneResult>('POST', '/ai/scene', { ...input, hour: new Date().getHours() }),
  caption: (input: { placeId?: string; title: string; artist: string }) =>
    request<{ text: string; engine: Engine }>('POST', '/ai/caption', { ...input, hour: new Date().getHours() }),
  persona: (placeId: string) => request<{ persona: Persona }>('GET', `/places/${placeId}/persona`),

  throwBottle: (placeId: string, input: Pos & { title: string; artist: string; message: string }) =>
    request<{ bottle: Bottle }>('POST', `/places/${placeId}/bottles`, input),
  waitingBottles: (placeId: string) => request<{ count: number }>('GET', `/places/${placeId}/bottles/waiting`),
  myBottles: () => request<{ thrown: Bottle[]; picked: Bottle[] }>('GET', '/me/bottles'),

  startQuiz: (placeId: string, at?: Pos) => request<{ quiz: Quiz }>('POST', `/places/${placeId}/quiz`, at ?? {}),
  answerQuiz: (quizId: string, round: number, choice: number) =>
    request<QuizAnswer>('POST', `/quizzes/${quizId}/answer`, { round, choice }),
  quizBoard: (placeId: string) => request<QuizBoard>('GET', `/places/${placeId}/quiz/board`),
  myRecords: () => request<{ records: RecordItem[] }>('GET', '/me/records'),
};

// ---- 此地知音 ----
export type QuizRoundType = 'emoji' | 'top' | 'live' | 'artist' | 'peak' | 'mood' | 'comment';

export interface QuizRound {
  type: QuizRoundType;
  prompt: string;
  clue: string | null;
  hint: string | null;
  options: { label: string; sub: string | null }[];
}

export interface Quiz {
  id: string;
  placeId: string;
  placeName: string;
  onSite: boolean;
  engine: Engine;
  rounds: QuizRound[];
}

export interface QuizResult {
  score: number;
  correct: number;
  total: number;
  title: string;
  onSite: boolean;
  best: number;
  isBest: boolean;
  rank: number | null;
}

export interface QuizAnswer {
  correct: boolean;
  answer: number;
  fact: string;
  points: number;
  score: number;
  streak: number;
  finished: boolean;
  result: QuizResult | null;
}

export interface BoardEntry {
  rank: number;
  user: { id: string; nickname: string };
  score: number;
  correct: number;
  total: number;
  title: string;
  onSite: boolean;
}

export interface QuizBoard {
  board: BoardEntry[];
  me: BoardEntry | null;
  players: number;
}

export interface RecordItem {
  placeId: string;
  placeName: string;
  imageUrl: string | null;
  moods: string[];
  visits: number;
  firstAt: string;
  best: { score: number; title: string } | null;
}

/**
 * 去 QQ 音乐听：有用户贴的链接就用它，否则跳 QQ 音乐搜索页（装了 App 的手机会由系统接管）。
 * 正式接入时可替换为 QQ 音乐开放平台的歌曲 ID 直达与 App Scheme。
 */
export function qqMusicUrl(song: { title: string; artist: string; url?: string | null }): string {
  if (song.url) return song.url;
  return `https://y.qq.com/n/ryqq/search?w=${encodeURIComponent(`${song.title} ${song.artist}`)}`;
}
