/**
 * 在指定坐标周围生成一套「有生活感」的示例数据，用于演示和本地联调：
 * 6 个地点（带封面）、12 位用户、三类歌曲（含官方演出）、评论、漂流瓶，
 * 以及过去 3 周按各地点「热闹时段」分布的打卡 / 在听 / 点赞——声音画像和时段推荐因此有真实的统计可看。
 *
 *   npm run seed -- --lat 31.24 --lng 121.49      # 默认上海外滩
 *
 * 写入 DB_PATH（默认 musichere.db）。数据库里已有示例数据时直接跳过（要重建请删掉数据库文件）。
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { localHour } from './ai/time.ts';
import { openDb, transaction } from './db.ts';
import { row, type Deps } from './http.ts';
import { pickBottle, throwBottle } from './services/bottles.ts';
import { answerQuiz, startQuiz } from './services/quiz.ts';
import { addPrint } from './services/resonance.ts';
import { addComment } from './services/comments.ts';
import { UPLOAD_PREFIX } from './services/images.ts';
import { checkIn, createPlace, type Category } from './services/places.ts';
import { addListen, addPlaceSong, setVote, type AddPlaceSongInput } from './services/placeSongs.ts';
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

// 可拨动的时钟：让示例活动分布在过去几周的不同时段
const realNow = Date.now();
let clock = realNow;
const tz = process.env.APP_TZ || 'Asia/Shanghai';
const db = openDb(process.env.DB_PATH ?? 'musichere.db');
const deps: Deps = {
  db,
  now: () => new Date(clock),
  rng: (() => {
    // 独立的固定种子：出题洗牌用，不打乱下面 rand() 的序列
    let s = 7;
    return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  })(),
  adminKey: null,
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  llm: null,
  tz,
};

// 固定种子的随机数，保证每次生成的数据一样
let seed = 20260601;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;

/** daysAgo 天前、本地时间 hour:minute 的时刻。 */
const tzOffsetH = (localHour(new Date(realNow), tz) - new Date(realNow).getUTCHours() + 24) % 24;
function localTime(daysAgo: number, hour: number, minute = 0): number {
  const d = new Date(realNow - daysAgo * 86_400_000);
  d.setUTCHours((hour - tzOffsetH + 24) % 24, minute, 0, 0);
  return Math.min(d.getTime(), realNow - 60_000);
}

const NAMES = ['阿晴', '小夏', '路过的人', '晚风', '林深', '七七', '阿杰', '鱼丸', '北北', '山茶', '夏日汽水', '周末不加班'];

interface Spot {
  name: string;
  image: string;
  category: Category;
  description: string;
  offset: [number, number];
  /** 这个地方最热闹的本地小时（活动围绕它分布） */
  peaks: number[];
  /** 每位用户每天来这里的概率 */
  popularity: number;
  songs: (AddPlaceSongInput & { by: number })[];
  official?: AddPlaceSongInput[];
  comments?: { by: number; body: string; mood?: string; daysAgo: number }[];
  bottles?: { by: number; title: string; artist: string; message: string; daysAgo: number; pickedBy?: number }[];
}

const spots: Spot[] = [
  {
    name: '江边步道',
    popularity: 0.42,
    image: 'riverside',
    category: 'street',
    description: '傍晚沿江散步，风和灯都刚刚好。',
    offset: [0, 0],
    peaks: [18, 19],
    songs: [
      { by: 0, kind: 'vibe', title: '晴天', artist: '周杰伦', note: '日落时分循环这首' },
      { by: 3, kind: 'vibe', title: '夏夜晚风', artist: '伍佰', note: '江风一吹，就想听这首' },
      { by: 1, kind: 'vibe', title: 'Hotel California', artist: 'Eagles', note: '夜风里听吉他 solo' },
      { by: 2, kind: 'vibe', title: '后来', artist: '刘若英', note: '一个人走到桥边的时候' },
      { by: 6, kind: 'vibe', title: '日落大道', artist: '梁博' },
      { by: 4, kind: 'frequent', title: '倔强', artist: '五月天', note: '夜跑路过总听这首' },
      { by: 1, kind: 'live', title: '海阔天空', artist: 'Beyond', eventType: 'busker', performer: '江边吉他大叔', eventAt: '2026-09-20', note: '围了一圈人一起唱' },
    ],
    comments: [
      { by: 0, body: '傍晚六点半来最舒服，江风加日落。', mood: '惬意', daysAgo: 6 },
      { by: 2, body: '周末有街头艺人，带耳机反而可惜。', mood: '热闹', daysAgo: 3 },
      { by: 7, body: '对岸的灯一亮，整条江都像在放 MV。', mood: '浪漫', daysAgo: 1 },
    ],
    bottles: [
      { by: 3, title: '夏夜晚风', artist: '伍佰', message: '给下一个走到这里的人：今天的晚霞是粉色的，希望你也看到了。', daysAgo: 4 },
      { by: 9, title: '稻香', artist: '周杰伦', message: '如果你今天有点累，就在这坐一会儿吧，江风会把烦恼吹走。', daysAgo: 2 },
      { by: 5, title: '小幸运', artist: '田馥甄', message: '我在这里遇见了喜欢的人，把这份好运留给你。', daysAgo: 1 },
      { by: 10, title: '平凡之路', artist: '朴树', message: '毕业前最后一次来江边，祝你前程似锦。', daysAgo: 9, pickedBy: 0 },
    ],
  },
  {
    name: '街角咖啡馆',
    popularity: 0.3,
    image: 'cafe',
    category: 'cafe',
    description: '木质桌椅，下午常有人写东西。',
    offset: [120, 60],
    peaks: [14, 15],
    songs: [
      { by: 1, kind: 'vibe', title: 'Fly Me to the Moon', artist: 'Frank Sinatra', note: '午后的阳光照在桌上' },
      { by: 8, kind: 'vibe', title: '慢慢喜欢你', artist: '莫文蔚' },
      { by: 2, kind: 'frequent', title: 'Take Five', artist: 'The Dave Brubeck Quartet', note: '店里循环播放' },
      { by: 0, kind: 'frequent', title: '小幸运', artist: '田馥甄' },
      { by: 9, kind: 'vibe', title: '宁夏', artist: '梁静茹', note: '看书看到睡着' },
    ],
    comments: [
      { by: 1, body: '靠窗的位置写东西很专注。', mood: '安静', daysAgo: 5 },
      { by: 8, body: '下午三点的光线最好，拍照很出片。', mood: '惬意', daysAgo: 2 },
    ],
    bottles: [{ by: 8, title: '慢慢喜欢你', artist: '莫文蔚', message: '点一杯热拿铁，靠窗坐，相信我。', daysAgo: 3 }],
  },
  {
    name: '地铁口广场',
    popularity: 0.26,
    image: 'station',
    category: 'station',
    description: '人来人往，周末常有即兴演出。',
    offset: [-180, 140],
    peaks: [21, 22, 8],
    songs: [
      { by: 0, kind: 'vibe', title: '平凡之路', artist: '朴树', note: '赶早班地铁出站时' },
      { by: 11, kind: 'vibe', title: '孤独患者', artist: '陈奕迅', note: '加班到深夜出站' },
      { by: 6, kind: 'frequent', title: 'Blinding Lights', artist: 'The Weeknd' },
      { by: 2, kind: 'live', title: '起风了', artist: '买辣椒也用券', eventType: 'improv', performer: '路过的大学生乐队', eventAt: '2026-09-14', note: '完全即兴，效果很好' },
    ],
    official: [
      { kind: 'live', title: '夜空中最亮的星', artist: '逃跑计划', eventType: 'concert', performer: '逃跑计划', eventTitle: '城市广场音乐周 · 开幕场', eventAt: '2026-08-08' },
    ],
    comments: [{ by: 11, body: '十点多出站，广场上还有人在弹唱，突然就不累了。', mood: '治愈', daysAgo: 2 }],
  },
  {
    name: '小公园长椅',
    popularity: 0.14,
    image: 'park',
    category: 'park',
    description: '树荫下的长椅，能听见远处的喷泉。',
    offset: [260, -150],
    peaks: [7, 8],
    songs: [
      { by: 2, kind: 'vibe', title: 'River Flows in You', artist: 'Yiruma' },
      { by: 4, kind: 'vibe', title: 'Summer', artist: '久石让', note: '清晨跑完步坐一会儿' },
      { by: 1, kind: 'frequent', title: '童话镇', artist: '陈一发儿' },
      { by: 5, kind: 'vibe', title: '小情歌', artist: '苏打绿' },
    ],
    comments: [{ by: 4, body: '早上七点半，阳光从树叶缝里漏下来。', mood: '清新', daysAgo: 4 }],
  },
  {
    name: '老街书店',
    popularity: 0.12,
    image: 'bookstore',
    category: 'shop',
    description: '巷子尽头的二手书店，下午的光是金色的。',
    offset: [-90, -220],
    peaks: [15, 16],
    songs: [
      { by: 9, kind: 'vibe', title: '理想三旬', artist: '陈鸿宇', note: '翻到一本旧诗集的时候' },
      { by: 5, kind: 'vibe', title: '斑马，斑马', artist: '宋冬野' },
      { by: 3, kind: 'vibe', title: 'Clair de Lune', artist: 'Claude Debussy' },
      { by: 9, kind: 'frequent', title: '成都', artist: '赵雷', note: '老板最爱放' },
    ],
    comments: [{ by: 5, body: '老板会给常客留一杯茶，书架最上层有宝藏。', mood: '怀旧', daysAgo: 3 }],
    bottles: [{ by: 9, title: '理想三旬', artist: '陈鸿宇', message: '第三排书架里夹了一张明信片，送给你。', daysAgo: 5 }],
  },
  {
    name: '天台 Livehouse',
    popularity: 0.18,
    image: 'livehouse',
    category: 'venue',
    description: '每周五晚上有本地乐队驻场。',
    offset: [330, 200],
    peaks: [21, 22],
    songs: [
      { by: 6, kind: 'live', title: '杀死那个石家庄人', artist: '万能青年旅店', eventType: 'concert', performer: '周五驻场乐队', eventAt: '2026-09-26', note: '全场大合唱' },
      { by: 10, kind: 'live', title: '秦皇岛', artist: '万能青年旅店', eventType: 'concert', performer: '周五驻场乐队', eventAt: '2026-09-19' },
      { by: 7, kind: 'vibe', title: '突然的自我', artist: '伍佰', note: '散场后在天台吹风' },
    ],
    official: [
      { kind: 'live', title: '光年之外', artist: '邓紫棋', eventType: 'concert', performer: '城市翻唱之夜', eventTitle: '天台夏末音乐会', eventAt: '2026-10-10' },
    ],
    comments: [{ by: 6, body: '小号一响全场都安静了，这辈子记得这一晚。', mood: '热血', daysAgo: 6 }],
  },
];

const exists = row(db.prepare("SELECT 1 AS x FROM places WHERE name = '江边步道'").get());
if (exists) {
  console.log('数据库里已有示例数据，跳过。要重新生成，请先删除数据库文件。');
  db.close();
  process.exit(0);
}

const created: { id: string; name: string; coords: { lat: number; lng: number } }[] = [];

// 各地点「听起来」的拍子与调（共鸣指纹），模拟过去几周用户在现场贡献的记录
const PRINTS: Record<string, { bpm: number; tonic: number; mode: 'major' | 'minor' | 'drone'; source: 'mic' | 'motion' }> = {
  江边步道: { bpm: 112, tonic: 9, mode: 'drone', source: 'motion' }, // 散步的脚步 + 江上轮船的嗡鸣（A）
  街角咖啡馆: { bpm: 84, tonic: 5, mode: 'major', source: 'mic' },
  地铁口广场: { bpm: 120, tonic: 4, mode: 'drone', source: 'mic' }, // 闸机与列车进站的低鸣
  小公园长椅: { bpm: 72, tonic: 7, mode: 'major', source: 'motion' },
  老街书店: { bpm: 66, tonic: 2, mode: 'major', source: 'mic' },
  '天台 Livehouse': { bpm: 128, tonic: 9, mode: 'minor', source: 'mic' },
};
let users: { id: string }[] = [];
transaction(db, () => {
  clock = realNow - 30 * 86_400_000;
  users = NAMES.map((nickname) => createGuest(deps, nickname).user);

  for (const spot of spots) {
    const coords = at(...spot.offset);
    clock = realNow - 25 * 86_400_000;
    const { place } = createPlace(deps, users[0]!.id, {
      name: spot.name,
      description: spot.description,
      category: spot.category,
      ...coords,
    });
    created.push({ id: place.id, name: spot.name, coords });

    // 封面
    const file = `seed-${spot.image}.jpg`;
    mkdirSync(deps.uploadDir, { recursive: true });
    copyFileSync(join(import.meta.dirname, '..', 'seed-images', `${spot.image}.jpg`), join(deps.uploadDir, file));
    db.prepare('UPDATE places SET image_url = ? WHERE id = ?').run(UPLOAD_PREFIX + file, place.id);

    // 歌曲：分享时间散布在过去三周
    const psIds: { id: string; kind: string }[] = [];
    spot.songs.forEach(({ by, ...song }, i) => {
      clock = localTime(21 - i * 2, pick(spot.peaks), Math.floor(rand() * 60));
      psIds.push({ id: addPlaceSong(deps, users[by]!.id, place.id, song).placeSong.id, kind: song.kind });
    });
    for (const song of spot.official ?? []) {
      clock = localTime(20, 12);
      psIds.push({ id: addPlaceSong(deps, null, place.id, song).placeSong.id, kind: song.kind });
    }

    // 过去三周的日常：在热闹时段前后打卡、听歌、点赞
    for (let day = 20; day >= 1; day--) {
      for (const u of users) {
        if (rand() > spot.popularity) continue;
        const peak = pick(spot.peaks);
        const hour = Math.max(0, Math.min(23, peak + Math.round((rand() - 0.5) * 2.4)));
        clock = localTime(day, hour, Math.floor(rand() * 60));
        checkIn(deps, u.id, place.id, coords.lat, coords.lng, undefined);
        const ps = pick(psIds);
        if (ps.kind === 'frequent' || rand() < 0.35) addListen(deps, u.id, ps.id);
        if (rand() < 0.55) setVote(deps, u.id, pick(psIds).id, 1);
      }
    }

    (spot.comments ?? []).forEach((c, i) => {
      clock = localTime(c.daysAgo, pick(spot.peaks), Math.floor(rand() * 60));
      // 第一条留言关联这里分享的第一首歌（「此地知音」会拿它出题）
      addComment(deps, users[c.by]!.id, place.id, { body: c.body, mood: c.mood, placeSongId: i === 0 ? psIds[0]?.id : undefined });
    });

    // 漂流瓶：投放（必须在现场 → 用地点坐标），部分已被捡起
    for (const b of spot.bottles ?? []) {
      clock = localTime(b.daysAgo, pick(spot.peaks), Math.floor(rand() * 60));
      throwBottle(deps, users[b.by]!.id, place.id, { ...coords, title: b.title, artist: b.artist, message: b.message });
      if (b.pickedBy !== undefined) {
        clock = localTime(Math.max(0, b.daysAgo - 2), pick(spot.peaks));
        pickBottle(deps, users[b.pickedBy]!.id, place.id);
      }
    }
  }
});

// 共鸣指纹：每个地点 3–6 位用户贡献过
for (const [pi, { id, name, coords }] of created.entries()) {
  const p = PRINTS[name];
  if (!p) continue;
  const n = 3 + (pi % 4);
  for (let k = 0; k < n; k++) {
    clock = localTime(2 + k * 2, 18, 5 * k);
    const jitter = (rand() - 0.5) * 4;
    addPrint(deps, users[(k + pi) % users.length]!.id, id, {
      ...coords,
      bpm: p.bpm + jitter,
      confidence: 0.55 + rand() * 0.35,
      source: p.source,
      ...(k % 3 === 2 ? {} : { tonic: p.tonic, mode: p.mode }),
    });
  }
}

// 此地知音：每个地点有几位老用户玩过，知音榜上有人
for (const [pi, { id, coords }] of created.entries()) {
  const players = [1, 2, 3, 4, 5, 6, 7].filter((_, i) => (i + pi) % 3 !== 0).slice(0, 4);
  for (const [k, ui] of players.entries()) {
    clock = localTime(1 + k, 19, 10 * k);
    const onSite = k % 2 === 0;
    const quiz = await startQuiz(deps, users[ui]!.id, id, onSite ? coords : {});
    const { rounds } = row<{ rounds: string }>(db.prepare('SELECT rounds FROM quizzes WHERE id = ?').get(quiz.id))!;
    const answers = (JSON.parse(rounds) as { answer: number }[]).map((r) => r.answer);
    const skill = [0.95, 0.75, 0.6, 0.45][k]!;
    answers.forEach((right, i) => {
      clock += 2000 + Math.floor(rand() * 10_000);
      answerQuiz(deps, users[ui]!.id, quiz.id, i, rand() < skill ? right : (right + 1) % 4);
    });
  }
}

console.log(`已在 (${center.lat}, ${center.lng}) 周围生成 ${spots.length} 个示例地点、${NAMES.length} 位用户和三周的活动记录`);
db.close();
