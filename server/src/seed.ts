/**
 * 在指定坐标周围生成示例数据（地点、用户上传的歌、官方演出记录、评论），方便本地联调。
 *
 *   npm run seed -- --lat 31.24 --lng 121.49      # 默认上海外滩
 *
 * 会写入 DB_PATH（默认 musichere.db）。重复执行是安全的：同名地点/同一首歌会复用。
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, transaction } from './db.ts';
import type { Deps } from './http.ts';
import { addComment } from './services/comments.ts';
import { createPlace, type Category } from './services/places.ts';
import { addPlaceSong, setVote, type AddPlaceSongInput } from './services/placeSongs.ts';
import { UPLOAD_PREFIX } from './services/images.ts';
import { createGuest } from './services/users.ts';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

const center = { lat: arg('lat', 31.24), lng: arg('lng', 121.49) };
const at = (northM: number, eastM: number) => ({
  lat: center.lat + northM / 111_195,
  lng: center.lng + eastM / (111_195 * Math.cos((center.lat * Math.PI) / 180)),
});

const db = openDb(process.env.DB_PATH ?? 'musichere.db');
const deps: Deps = { db, now: () => new Date(), rng: Math.random, adminKey: null, uploadDir: process.env.UPLOAD_DIR ?? 'uploads', llm: null, tz: process.env.APP_TZ || 'Asia/Shanghai' };

interface Spot {
  name: string;
  /** seed-images/ 下的封面图文件名（不含扩展名） */
  image: string;
  category: Category;
  description: string;
  offset: [number, number];
  /** 用户上传 */
  songs: (AddPlaceSongInput & { by: number })[];
  /** 官方记录 */
  official?: AddPlaceSongInput[];
  comments?: { by: number; body: string; mood?: string }[];
}

const spots: Spot[] = [
  {
    name: '江边步道',
    image: 'riverside',
    category: 'street',
    description: '傍晚沿江散步，风和灯都刚刚好。',
    offset: [0, 0],
    songs: [
      { by: 0, kind: 'vibe', title: '晴天', artist: '周杰伦', note: '日落时分循环这首' },
      { by: 1, kind: 'vibe', title: 'Hotel California', artist: 'Eagles', note: '夜风里听吉他 solo' },
      { by: 2, kind: 'vibe', title: '后来', artist: '刘若英' },
      { by: 0, kind: 'frequent', title: '城市猎人', artist: '陈奕迅', note: '跑步路过总听这首' },
      {
        by: 1,
        kind: 'live',
        title: '海阔天空',
        artist: 'Beyond',
        eventType: 'busker',
        performer: '江边吉他大叔',
        eventAt: '2026-05-20',
        note: '围了一圈人一起唱',
      },
    ],
    comments: [
      { by: 0, body: '傍晚六点半来最舒服，江风加日落。', mood: '惬意' },
      { by: 2, body: '周末有街头艺人，带耳机反而可惜。', mood: '热闹' },
    ],
  },
  {
    name: '街角咖啡馆',
    image: 'cafe',
    category: 'cafe',
    description: '木质桌椅，下午常有人写东西。',
    offset: [120, 60],
    songs: [
      { by: 1, kind: 'vibe', title: 'Fly Me to the Moon', artist: 'Frank Sinatra' },
      { by: 2, kind: 'frequent', title: 'Take Five', artist: 'The Dave Brubeck Quartet', note: '店里循环播放' },
      { by: 0, kind: 'frequent', title: '小幸运', artist: '田馥甄' },
    ],
    comments: [{ by: 1, body: '靠窗的位置写东西很专注。', mood: '安静' }],
  },
  {
    name: '地铁口广场',
    image: 'station',
    category: 'station',
    description: '人来人往，周末常有即兴演出。',
    offset: [-180, 140],
    songs: [
      { by: 0, kind: 'vibe', title: '平凡之路', artist: '朴树', note: '赶早班地铁出站时' },
      {
        by: 2,
        kind: 'live',
        title: '起风了',
        artist: '买辣椒也用券',
        eventType: 'improv',
        performer: '路过的大学生乐队',
        eventAt: '2026-06-14',
        note: '完全即兴，效果很好',
      },
    ],
    official: [
      {
        kind: 'live',
        title: '夜空中最亮的星',
        artist: '逃跑计划',
        eventType: 'concert',
        performer: '逃跑计划',
        eventTitle: '城市广场音乐周 · 开幕场',
        eventAt: '2026-08-08',
      },
    ],
  },
  {
    name: '小公园长椅',
    image: 'park',
    category: 'park',
    description: '树荫下的长椅，能听见远处的喷泉。',
    offset: [260, -150],
    songs: [
      { by: 2, kind: 'vibe', title: 'River Flows in You', artist: 'Yiruma' },
      { by: 1, kind: 'frequent', title: '童话镇', artist: '陈一发儿' },
    ],
  },
];

transaction(db, () => {
  const users = ['阿晴', '小夏', '路过的人'].map((nickname) => createGuest(deps, nickname).user);

  for (const spot of spots) {
    const [n, e] = spot.offset;
    const { place } = createPlace(deps, users[0]!.id, {
      name: spot.name,
      description: spot.description,
      category: spot.category,
      ...at(n, e),
    });

    // 封面：复制到上传目录，文件名固定，重复 seed 时覆盖同一个文件
    const file = `seed-${spot.image}.jpg`;
    mkdirSync(deps.uploadDir, { recursive: true });
    copyFileSync(join(import.meta.dirname, '..', 'seed-images', `${spot.image}.jpg`), join(deps.uploadDir, file));
    db.prepare('UPDATE places SET image_url = ? WHERE id = ?').run(UPLOAD_PREFIX + file, place.id);

    for (const { by, ...song } of spot.songs) {
      addPlaceSong(deps, users[by]!.id, place.id, song);
    }
    for (const song of spot.official ?? []) {
      addPlaceSong(deps, null, place.id, song);
    }
    // 让每个人互相点一点赞，榜单有点层次
    const songs = db
      .prepare('SELECT id, submitted_by FROM place_songs WHERE place_id = ?')
      .all(place.id) as { id: string; submitted_by: string | null }[];
    songs.forEach((ps, i) => {
      users.forEach((u, j) => {
        if (u.id !== ps.submitted_by && (i + j) % 2 === 0) setVote(deps, u.id, ps.id, 1);
      });
    });
    for (const c of spot.comments ?? []) {
      addComment(deps, users[c.by]!.id, place.id, { body: c.body, mood: c.mood });
    }
  }
});

console.log(`已在 (${center.lat}, ${center.lng}) 周围生成 ${spots.length} 个示例地点`);
db.close();
