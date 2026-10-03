import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CATALOG } from '../ai/catalog.ts';
import { LlmError } from '../ai/llm.ts';
import type { Mood } from '../ai/moods.ts';
import { MOOD_LIST } from '../ai/moods.ts';
import { moodShares, placePersona } from '../ai/persona.ts';
import { songMoods } from '../ai/tags.ts';
import { hourDistance, windowLabel } from '../ai/time.ts';
import { haversineM } from '../geo.ts';
import { HttpError, notFound, row, rows, type Deps } from '../http.ts';
import { listPlaceSongs, type PlaceSongDto } from './placeSongs.ts';
import { checkinAllowanceM, getPlaceRow } from './places.ts';

/**
 * 「此地知音」：用一个地点真实沉淀下来的数据出 5 道题，看你有多懂这里。
 *
 * - 题目全部来自这个地点的人群记忆（最受欢迎的歌、发生过的现场、热闹时段、情绪、留言），
 *   另有一道「AI 出谜」：大模型用几个 emoji 描述这里的一首歌（没有大模型时按情绪规则出谜）；
 * - 答案只存在服务端，逐题提交、逐题揭晓，揭晓时附上一条这里的「冷知识」；
 * - 计分：答对 100 + 速度奖励（15 秒内越快越多，最多 50）+ 连对奖励；人在现场时整局 ×1.2；
 * - 每个地点有一张「知音榜」，按每人最好成绩排名。
 */

export type RoundType = 'emoji' | 'top' | 'live' | 'artist' | 'peak' | 'mood' | 'comment';

interface Round {
  type: RoundType;
  prompt: string;
  /** emoji 谜面等补充信息 */
  clue: string | null;
  hint: string | null;
  options: { label: string; sub: string | null }[];
  answer: number;
  fact: string;
}

export type PublicRound = Omit<Round, 'answer' | 'fact'>;

interface Answer {
  choice: number;
  correct: boolean;
  points: number;
  ms: number;
}

interface QuizRow {
  id: string;
  user_id: string;
  place_id: string;
  rounds: string;
  answers: string;
  on_site: number;
  score: number;
  correct: number;
  created_at: string;
  last_at: string;
  finished_at: string | null;
}

export interface QuizDto {
  id: string;
  placeId: string;
  placeName: string;
  onSite: boolean;
  engine: { kind: 'llm' | 'rules'; label: string };
  rounds: PublicRound[];
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

const ROUNDS = 5;
const OPTIONS = 4;
const FAST_MS = 15_000;
const ON_SITE_BONUS = 1.2;

const MOOD_EMOJI: Record<Mood, string> = {
  惬意: '☕️🌤️',
  治愈: '🌱🫖',
  怀旧: '📼🕰️',
  浪漫: '🌹💌',
  热血: '🔥🏃',
  欢快: '🎉😆',
  静谧: '🌙🤫',
  孤独: '🚶🌧️',
  伤感: '💧💔',
  自由: '🕊️🌊',
  夜色: '🌃✨',
  律动: '🥁🕺',
  清新: '🍃☀️',
  梦幻: '🫧🌌',
};
const KIND_EMOJI = { vibe: '📍', frequent: '🎧', live: '🎤' } as const;

export function titleFor(correct: number, total: number): string {
  if (total > 0 && correct === total) return '此地知音';
  if (correct / Math.max(1, total) >= 0.6) return '老熟人';
  if (correct > 0) return '过客';
  return '初来乍到';
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

function shuffle<T>(deps: Deps, list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(deps.rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** 把正确项和干扰项打乱成选项，返回正确项下标。 */
function arrange(deps: Deps, right: Round['options'][number], wrong: Round['options']): { options: Round['options']; answer: number } {
  const options = shuffle(deps, [right, ...wrong.slice(0, OPTIONS - 1)]);
  return { options, answer: options.indexOf(right) };
}

/** 曲库里不属于这个地点的歌，作为干扰项。 */
function decoySongs(deps: Deps, songs: PlaceSongDto[], n = OPTIONS - 1): Round['options'] {
  const here = new Set(songs.map((s) => norm(s.song.title)));
  return shuffle(
    deps,
    CATALOG.filter((c) => !here.has(norm(c.title))),
  )
    .slice(0, n)
    .map((c) => ({ label: `《${c.title}》`, sub: c.artist }));
}

const songOption = (s: PlaceSongDto) => ({ label: `《${s.song.title}》`, sub: s.song.artist });

function crowdFact(s: PlaceSongDto): string {
  const bits = [s.likes ? `${s.likes} 个赞` : '', s.listeners ? `近 30 天 ${s.listeners} 人在这里听过` : ''].filter(Boolean);
  const said = s.note ? `；有人说：“${s.note}”` : '';
  return `《${s.song.title}》— ${s.song.artist}${bits.length ? `：${bits.join('，')}` : ''}${said}`;
}

const emojiSchema = z.object({
  emoji: z.string().min(1).max(32),
  hint: z.string().min(2).max(24),
});

/** AI 出谜：用 emoji 描述一首歌。大模型不可用、或谜面泄露了歌名歌手时，退回规则谜面。 */
async function emojiRound(deps: Deps, target: PlaceSongDto, songs: PlaceSongDto[], moods: Mood[]): Promise<{ round: Round; ai: boolean }> {
  const { title, artist } = target.song;
  let clue = '';
  let hint = '';
  let ai = false;
  if (deps.llm) {
    try {
      const out = await deps.llm.json(
        emojiSchema,
        [
          {
            role: 'system',
            content:
              '你在主持一个猜歌小游戏。用 3-5 个 emoji 描述一首歌（歌名意象、歌词画面或情绪），再给一句不超过 12 个字的提示。谜面和提示里都不能出现歌名、歌手名或其中的字。只输出 JSON：{"emoji":"…","hint":"…"}',
          },
          { role: 'user', content: `歌曲：《${title}》- ${artist}` },
        ],
        { timeoutMs: 8000, temperature: 0.9 },
      );
      // 谜面不能直接说出歌名、歌手，或歌名里任意连续两个字
      const chars = [...norm(title)];
      const leaks = (t: string) =>
        norm(t).includes(norm(title)) || norm(t).includes(norm(artist)) || chars.slice(1).some((ch, i) => norm(t).includes(chars[i]! + ch));
      if (!/[\p{Letter}\p{Number}]/u.test(out.emoji) && !leaks(out.hint)) {
        clue = out.emoji.replace(/\s+/g, '');
        hint = out.hint.trim();
        ai = true;
      }
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
    }
  }
  if (!ai) {
    clue = [...moods.slice(0, 2).map((m) => MOOD_EMOJI[m]), KIND_EMOJI[target.kind]].join('');
    // 只给歌名长度，不给歌手线索（否则一眼就能排除干扰项）
    const han = /[\p{Script=Han}]/u.test(title);
    hint = han ? `歌名 ${[...title].length} 个字` : `外文歌名，${title.split(/\s+/).length} 个词`;
  }
  const { options, answer } = arrange(deps, songOption(target), decoySongs(deps, songs));
  return {
    ai,
    round: {
      type: 'emoji',
      prompt: 'AI 出谜：这串 emoji 说的是这里的哪首歌？',
      clue,
      hint,
      options,
      answer,
      fact: crowdFact(target),
    },
  };
}

async function buildRounds(deps: Deps, placeId: string, placeName: string): Promise<{ rounds: Round[]; ai: boolean }> {
  const songs = listPlaceSongs(deps, { placeId, userId: null });
  if (songs.length === 0) {
    throw new HttpError(409, 'not_enough_data', '这里还没有人留下歌，先分享一首再来玩吧');
  }
  const persona = await placePersona(deps, placeId);
  const byWeight = [...songs].sort((a, b) => b.weight - a.weight);
  const top = byWeight[0]!;
  const candidates: Round[] = [];

  // 最受欢迎
  {
    const { options, answer } = arrange(deps, songOption(top), decoySongs(deps, songs));
    candidates.push({
      type: 'top',
      prompt: `${placeName}最受欢迎的一首是？`,
      clue: null,
      hint: '点赞、在听、打卡都会让一首歌在这里更受欢迎',
      options,
      answer,
      fact: crowdFact(top),
    });
  }

  // 现场
  // 不和「最受欢迎」同一首，免得两道题一个答案
  const lives = songs.filter((s) => s.kind === 'live' && s.song.id !== top.song.id);
  if (lives.length) {
    const s = shuffle(deps, lives)[0]!;
    const { options, answer } = arrange(deps, songOption(s), decoySongs(deps, songs));
    const who = [s.live?.performer, s.live?.eventTitle].filter(Boolean).join(' · ');
    candidates.push({
      type: 'live',
      prompt: '哪首歌曾在这里响起过现场？',
      clue: null,
      hint: '演唱会、即兴、街头艺人都算',
      options,
      answer,
      fact: `《${s.song.title}》${who ? `由 ${who} ` : ''}在这里唱过${s.live?.eventAt ? `（${s.live.eventAt.slice(0, 10)}）` : ''}${s.source === 'official' ? '，这是一条官方记录' : '，是路过的人记下来的'}。`,
    });
  }

  // 常听歌手
  if (persona.topArtists.length) {
    const right = persona.topArtists[0]!;
    const here = new Set(songs.map((s) => norm(s.song.artist)));
    const decoys = shuffle(deps, [...new Set(CATALOG.map((c) => c.artist))].filter((a) => !here.has(norm(a))))
      .slice(0, OPTIONS - 1)
      .map((a) => ({ label: a, sub: null }));
    const { options, answer } = arrange(deps, { label: right, sub: null }, decoys);
    const n = songs.filter((s) => s.song.artist === right).length;
    candidates.push({
      type: 'artist',
      prompt: '人们最常在这里听谁的歌？',
      clue: null,
      hint: null,
      options,
      answer,
      fact: `${right} 在这里被留下了 ${n} 首歌。${persona.topArtists.length > 1 ? `排在后面的是 ${persona.topArtists.slice(1).join('、')}。` : ''}`,
    });
  }

  // 热闹时段
  if (persona.peak) {
    const peak = persona.peak.startHour;
    const others = shuffle(deps, [7, 10, 12, 15, 18, 21, 0].filter((h) => hourDistance(h, peak) >= 3)).slice(0, OPTIONS - 1);
    if (others.length === OPTIONS - 1) {
      const { options, answer } = arrange(
        deps,
        { label: windowLabel(peak), sub: null },
        others.map((h) => ({ label: windowLabel(h), sub: null })),
      );
      candidates.push({
        type: 'peak',
        prompt: '这里什么时候最热闹？',
        clue: null,
        hint: '按打卡、在听、点赞、留言的时间统计',
        options,
        answer,
        fact: `${persona.peak.label}是${placeName}最热闹的时候。${persona.summary}`,
      });
    }
  }

  // 情绪
  const moods = persona.moods.map((m) => m.mood);
  if (moods.length) {
    const right = moods[0]!;
    const decoys = shuffle(deps, MOOD_LIST.filter((m) => !moods.slice(0, 2).includes(m)))
      .slice(0, OPTIONS - 1)
      .map((m) => ({ label: m, sub: MOOD_EMOJI[m] }));
    const { options, answer } = arrange(deps, { label: right, sub: MOOD_EMOJI[right] }, decoys);
    candidates.push({
      type: 'mood',
      prompt: `${placeName}听起来最像哪种情绪？`,
      clue: null,
      hint: '由这里每首歌的情绪按受欢迎程度加权得出',
      options,
      answer,
      fact: `「${right}」占了 ${Math.round(persona.moods[0]!.share * 100)}%。${persona.summary}`,
    });
  }

  // 留言
  const comment = row<{ body: string; nickname: string; place_song_id: string }>(
    deps.db
      .prepare(
        `SELECT c.body, u.nickname, c.place_song_id FROM comments c JOIN users u ON u.id = c.user_id
         WHERE c.place_id = ? AND c.place_song_id IS NOT NULL ORDER BY c.created_at DESC LIMIT 1`,
      )
      .get(placeId),
  );
  const linked = comment && songs.find((s) => s.id === comment.place_song_id);
  if (comment && linked) {
    const { options, answer } = arrange(deps, songOption(linked), decoySongs(deps, songs));
    candidates.push({
      type: 'comment',
      prompt: `${comment.nickname} 在这里留言：“${comment.body.slice(0, 40)}”——TA 当时在听哪首？`,
      clue: null,
      hint: null,
      options,
      answer,
      fact: crowdFact(linked),
    });
  }

  // AI 出谜：尽量选一首不是「最受欢迎」的歌，避免两题同一个答案
  const target = shuffle(deps, byWeight.length > 1 ? byWeight.slice(1) : byWeight)[0]!;
  const targetMoods = songMoods(deps, [target.song.id]).get(target.song.id) ?? moods;
  const emoji = await emojiRound(deps, target, songs, targetMoods);

  const rest = shuffle(deps, candidates).slice(0, ROUNDS - 1);
  return { rounds: shuffle(deps, [emoji.round, ...rest]), ai: emoji.ai };
}

const publicRound = ({ answer: _a, fact: _f, ...r }: Round): PublicRound => r;

export async function startQuiz(
  deps: Deps,
  userId: string,
  placeId: string,
  at: { lat?: number | undefined; lng?: number | undefined },
): Promise<QuizDto> {
  const place = getPlaceRow(deps, placeId);
  const onSite =
    at.lat !== undefined && at.lng !== undefined && haversineM(at.lat, at.lng, place.lat, place.lng) <= checkinAllowanceM(place.radius_m);
  const { rounds, ai } = await buildRounds(deps, placeId, place.name);
  const id = randomUUID();
  const now = deps.now().toISOString();
  deps.db
    .prepare(
      `INSERT INTO quizzes (id, user_id, place_id, rounds, answers, on_site, created_at, last_at)
       VALUES (?, ?, ?, ?, '[]', ?, ?, ?)`,
    )
    .run(id, userId, placeId, JSON.stringify(rounds), onSite ? 1 : 0, now, now);
  return {
    id,
    placeId,
    placeName: place.name,
    onSite,
    engine: ai && deps.llm ? { kind: 'llm', label: deps.llm.label } : { kind: 'rules', label: '本地规则引擎' },
    rounds: rounds.map(publicRound),
  };
}

export interface AnswerResult {
  correct: boolean;
  answer: number;
  fact: string;
  points: number;
  score: number;
  streak: number;
  finished: boolean;
  result: QuizResult | null;
}

export function answerQuiz(deps: Deps, userId: string, quizId: string, roundIndex: number, choice: number): AnswerResult {
  const q = row<QuizRow>(deps.db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId));
  if (!q || q.user_id !== userId) throw notFound('这局游戏');
  if (q.finished_at) throw new HttpError(409, 'quiz_finished', '这局已经结束了');
  const rounds = JSON.parse(q.rounds) as Round[];
  const answers = JSON.parse(q.answers) as Answer[];
  if (roundIndex !== answers.length) {
    throw new HttpError(409, 'out_of_order', '请按顺序作答', { expected: answers.length });
  }
  const round = rounds[roundIndex]!;
  if (choice < 0 || choice >= round.options.length) throw new HttpError(400, 'validation', '没有这个选项');

  const now = deps.now();
  const ms = Math.max(0, now.getTime() - new Date(q.last_at).getTime());
  const correct = choice === round.answer;
  let streak = 0;
  for (let i = answers.length - 1; i >= 0 && answers[i]!.correct; i--) streak++;
  streak = correct ? streak + 1 : 0;
  const raw = correct ? 100 + Math.round(50 * Math.max(0, 1 - ms / FAST_MS)) + 10 * (streak - 1) : 0;
  const points = Math.round(raw * (q.on_site ? ON_SITE_BONUS : 1));
  answers.push({ choice, correct, points, ms });

  const score = q.score + points;
  const nCorrect = q.correct + (correct ? 1 : 0);
  const finished = answers.length === rounds.length;
  const previousBest = finished ? bestScore(deps, userId, q.place_id) : null;
  deps.db
    .prepare('UPDATE quizzes SET answers = ?, score = ?, correct = ?, last_at = ?, finished_at = ? WHERE id = ?')
    .run(JSON.stringify(answers), score, nCorrect, now.toISOString(), finished ? now.toISOString() : null, quizId);

  let result: QuizResult | null = null;
  if (finished) {
    const board = leaderboard(deps, q.place_id, userId);
    result = {
      score,
      correct: nCorrect,
      total: rounds.length,
      title: titleFor(nCorrect, rounds.length),
      onSite: !!q.on_site,
      best: Math.max(score, previousBest ?? 0),
      isBest: previousBest === null || score > previousBest,
      rank: board.me?.rank ?? null,
    };
  }
  return { correct, answer: round.answer, fact: round.fact, points, score, streak, finished, result };
}

function bestScore(deps: Deps, userId: string, placeId: string): number | null {
  return (
    row<{ s: number | null }>(
      deps.db
        .prepare('SELECT MAX(score) AS s FROM quizzes WHERE user_id = ? AND place_id = ? AND finished_at IS NOT NULL')
        .get(userId, placeId),
    )?.s ?? null
  );
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

/** 知音榜：每人取最好的一局（同分时先达成者在前）。 */
export function leaderboard(deps: Deps, placeId: string, userId: string, limit = 10): { board: BoardEntry[]; me: BoardEntry | null; players: number } {
  getPlaceRow(deps, placeId);
  // SQLite 的 MAX() 聚合会让同一行的其他列取自分数最高的那一局
  const all = rows<{ user_id: string; nickname: string; score: number; correct: number; rounds: string; on_site: number; finished_at: string }>(
    deps.db
      .prepare(
        `SELECT q.user_id, u.nickname, MAX(q.score) AS score, q.correct, q.rounds, q.on_site, q.finished_at
         FROM quizzes q JOIN users u ON u.id = q.user_id
         WHERE q.place_id = ? AND q.finished_at IS NOT NULL
         GROUP BY q.user_id`,
      )
      .all(placeId),
  ).sort((a, b) => b.score - a.score || a.finished_at.localeCompare(b.finished_at));
  const entries = all.map((r, i): BoardEntry => {
    const total = (JSON.parse(r.rounds) as unknown[]).length;
    return {
      rank: i + 1,
      user: { id: r.user_id, nickname: r.nickname },
      score: r.score,
      correct: r.correct,
      total,
      title: titleFor(r.correct, total),
      onSite: !!r.on_site,
    };
  });
  return { board: entries.slice(0, limit), me: entries.find((e) => e.user.id === userId) ?? null, players: entries.length };
}

export interface RecordDto {
  placeId: string;
  placeName: string;
  imageUrl: string | null;
  moods: Mood[];
  visits: number;
  firstAt: string;
  best: { score: number; title: string } | null;
}

/** 唱片架：去过（打卡）或玩过的每个地点是一张唱片，颜色来自那里的情绪。 */
export function myRecords(deps: Deps, userId: string): RecordDto[] {
  const list = rows<{ place_id: string; name: string; image_url: string | null; visits: number; first_at: string }>(
    deps.db
      .prepare(
        `SELECT p.id AS place_id, p.name, p.image_url,
                (SELECT COUNT(*) FROM checkins c WHERE c.place_id = p.id AND c.user_id = ?) AS visits,
                MIN(x.at) AS first_at
         FROM (SELECT place_id, created_at AS at FROM checkins WHERE user_id = ?
               UNION ALL SELECT place_id, created_at FROM quizzes WHERE user_id = ? AND finished_at IS NOT NULL) x
         JOIN places p ON p.id = x.place_id
         GROUP BY p.id ORDER BY first_at ASC`,
      )
      .all(userId, userId, userId),
  );
  return list.map((r) => {
    const best = row<{ score: number; correct: number; rounds: string }>(
      deps.db
        .prepare(
          `SELECT score, correct, rounds FROM quizzes WHERE user_id = ? AND place_id = ? AND finished_at IS NOT NULL
           ORDER BY score DESC LIMIT 1`,
        )
        .get(userId, r.place_id),
    );
    return {
      placeId: r.place_id,
      placeName: r.name,
      imageUrl: r.image_url,
      moods: moodShares(deps, listPlaceSongs(deps, { placeId: r.place_id, userId: null }), 2).map((m) => m.mood),
      visits: r.visits,
      firstAt: r.first_at,
      best: best ? { score: best.score, title: titleFor(best.correct, (JSON.parse(best.rounds) as unknown[]).length) } : null,
    };
  });
}
