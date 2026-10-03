import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { titleFor } from '../src/services/quiz.ts';
import { BUND, createPlace, DAY, northOf, setup, startFakeLlm, type Client, type FakeLlm, type TestEnv } from './helpers.ts';

let env: TestEnv;
afterEach(async () => {
  // 「称号」那组是纯函数测试，没有建环境
  if (!env) return;
  await env.close();
  env = undefined as unknown as TestEnv;
});

/** 一个数据丰富的地点：多首歌、点赞、一场现场、一条关联歌曲的留言、若干打卡。 */
async function richPlace(a: Client, b: Client) {
  const place = await createPlace(a, '江边步道');
  const add = async (c: Client, body: Record<string, unknown>) => {
    const r = await c.post(`/places/${place.id}/songs`, body);
    assert.ok(r.status === 201 || r.status === 200, JSON.stringify(r.body));
    return r.body.placeSong as { id: string };
  };
  const sunny = await add(a, { title: '晴天', artist: '周杰伦', kind: 'vibe', note: '江风吹过来的时候' });
  await add(a, { title: '七里香', artist: '周杰伦', kind: 'frequent' });
  await add(b, { title: '海阔天空', artist: 'Beyond', kind: 'live', eventType: 'busker', performer: '小夏', eventAt: '2026-05-20' });
  await add(b, { title: '后来', artist: '刘若英', kind: 'vibe' });
  await b.put(`/place-songs/${sunny.id}/vote`, { value: 1 });
  await b.post(`/places/${place.id}/comments`, { body: '傍晚的江风配这首刚刚好', placeSongId: sunny.id });
  for (const c of [a, b]) await c.post(`/places/${place.id}/checkin`, BUND);
  return { place, sunny };
}

/** 答完一局：answerOf(i) 返回第 i 题要选的选项 */
async function play(c: Client, quiz: { id: string; rounds: unknown[] }, answerOf: (i: number, res: { answer: number } | null) => number) {
  let last: { answer: number; [k: string]: unknown } | null = null;
  const results = [];
  for (let i = 0; i < quiz.rounds.length; i++) {
    const res = await c.post(`/quizzes/${quiz.id}/answer`, { round: i, choice: answerOf(i, last) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    results.push(res.body);
    last = res.body;
  }
  return results;
}

describe('此地知音：出题', () => {
  beforeEach(async () => {
    env = await setup();
  });

  it('用地点的真实数据出 5 道题；答案和冷知识不下发', async () => {
    const a = env.client((await env.newUser('阿晴')).token);
    const b = env.client((await env.newUser('小夏')).token);
    const { place } = await richPlace(a, b);

    const res = await a.post(`/places/${place.id}/quiz`, BUND);
    assert.equal(res.status, 201);
    const quiz = res.body.quiz;
    assert.equal(quiz.placeName, '江边步道');
    assert.equal(quiz.onSite, true);
    assert.equal(quiz.engine.kind, 'rules');
    assert.equal(quiz.rounds.length, 5);
    const types = quiz.rounds.map((r: { type: string }) => r.type);
    assert.ok(types.includes('emoji'), '一定有一道 AI 出谜');
    assert.equal(new Set(types).size, 5, '题型不重复');
    for (const r of quiz.rounds) {
      assert.equal(r.options.length, 4);
      assert.equal(new Set(r.options.map((o: { label: string }) => o.label)).size, 4, '选项不重复');
      assert.equal('answer' in r, false);
      assert.equal('fact' in r, false);
    }
    const emoji = quiz.rounds.find((r: { type: string }) => r.type === 'emoji');
    assert.ok(emoji.clue.length > 0);
    assert.match(emoji.hint, /^(歌名 \d+ 个字|外文歌名)/);
  });

  it('没有歌的地点不能玩；不在现场也能玩，但不算现场', async () => {
    const a = env.client((await env.newUser()).token);
    const empty = await createPlace(a, '空地');
    const none = await a.post(`/places/${empty.id}/quiz`, {});
    assert.equal(none.status, 409);
    assert.equal(none.body.error, 'not_enough_data');

    await a.post(`/places/${empty.id}/songs`, { title: '晴天', artist: '周杰伦', kind: 'vibe' });
    const far = await a.post(`/places/${empty.id}/quiz`, northOf(BUND, 2000));
    assert.equal(far.status, 201);
    assert.equal(far.body.quiz.onSite, false);
    assert.ok(far.body.quiz.rounds.length >= 2);
  });
});

describe('此地知音：作答与计分', () => {
  beforeEach(async () => {
    env = await setup();
  });

  it('逐题揭晓答案与冷知识；不能跳题、重复答或答别人的局', async () => {
    const a = env.client((await env.newUser('阿晴')).token);
    const b = env.client((await env.newUser('小夏')).token);
    const { place } = await richPlace(a, b);

    const probe = (await a.post(`/places/${place.id}/quiz`, BUND)).body.quiz;
    const first = await a.post(`/quizzes/${probe.id}/answer`, { round: 0, choice: 0 });
    assert.equal(typeof first.body.answer, 'number');
    assert.ok(first.body.fact.length > 0);
    // 不能跳题、不能重复答
    assert.equal((await a.post(`/quizzes/${probe.id}/answer`, { round: 2, choice: 0 })).status, 409);
    assert.equal((await a.post(`/quizzes/${probe.id}/answer`, { round: 0, choice: 0 })).status, 409);
    // 别人的局看不到
    assert.equal((await b.post(`/quizzes/${probe.id}/answer`, { round: 1, choice: 0 })).status, 404);
  });

  it('答对得分、答错 0 分；结束后给出称号和排名', async () => {
    const a = env.client((await env.newUser('阿晴')).token);
    const b = env.client((await env.newUser('小夏')).token);
    const { place } = await richPlace(a, b);

    const q1 = (await b.post(`/places/${place.id}/quiz`, northOf(BUND, 3000))).body.quiz;
    const wrong = await play(b, q1, () => 0);
    const last = wrong.at(-1)!;
    assert.equal(last.finished, true);
    assert.equal(last.result.total, 5);
    assert.equal(last.result.onSite, false);
    assert.equal(last.result.rank, 1);
    assert.equal(last.result.isBest, true);
    assert.equal(last.result.title, titleFor(last.result.correct, 5));
    for (const r of wrong) {
      if (r.correct) assert.ok(r.points >= 100);
      else assert.equal(r.points, 0);
    }
    assert.equal(last.score, wrong.reduce((s, r) => s + r.points, 0));
    // 结束后不能再答
    assert.equal((await b.post(`/quizzes/${q1.id}/answer`, { round: 0, choice: 0 })).status, 409);
  });

  it('全对且秒答、人在现场：每题 (150 + 连对奖励) × 1.2', async () => {
    const a = env.client((await env.newUser('阿晴')).token);
    const b = env.client((await env.newUser('小夏')).token);
    const { place } = await richPlace(a, b);
    const quiz = (await a.post(`/places/${place.id}/quiz`, BUND)).body.quiz;

    const answers = await peekAnswers(quiz.id);
    const res = await play(a, quiz, (i) => answers[i]!);
    res.forEach((r, i) => {
      assert.equal(r.correct, true);
      assert.equal(r.streak, i + 1);
      assert.equal(r.points, Math.round((150 + 10 * i) * 1.2));
    });
    const result = res.at(-1)!.result;
    assert.equal(result.correct, 5);
    assert.equal(result.title, '此地知音');
    assert.equal(result.score, [0, 1, 2, 3, 4].reduce((s, i) => s + Math.round((150 + 10 * i) * 1.2), 0));
  });

  it('慢答拿不到速度奖励', async () => {
    const a = env.client((await env.newUser('阿晴')).token);
    const b = env.client((await env.newUser('小夏')).token);
    const { place } = await richPlace(a, b);
    const quiz = (await a.post(`/places/${place.id}/quiz`, northOf(BUND, 3000))).body.quiz;
    const answers = await peekAnswers(quiz.id);
    env.clock.advance(20_000);
    const r = await a.post(`/quizzes/${quiz.id}/answer`, { round: 0, choice: answers[0] });
    assert.equal(r.body.points, 100);
  });
});

describe('知音榜与唱片架', () => {
  beforeEach(async () => {
    env = await setup();
  });

  it('知音榜按每人最好成绩排名；唱片架收录去过和玩过的地点', async () => {
    const a = env.client((await env.newUser('阿晴')).token);
    const b = env.client((await env.newUser('小夏')).token);
    const c = env.client((await env.newUser('路人')).token);
    const { place } = await richPlace(a, b);

    const perfect = (await a.post(`/places/${place.id}/quiz`, BUND)).body.quiz;
    const ans = await peekAnswers(perfect.id);
    await play(a, perfect, (i) => ans[i]!);
    // 阿晴再玩一局全错：榜上仍是最好的那局
    const worse = (await a.post(`/places/${place.id}/quiz`, BUND)).body.quiz;
    const ans2 = await peekAnswers(worse.id);
    const r2 = await play(a, worse, (i) => (ans2[i]! + 1) % 4);
    assert.equal(r2.at(-1)!.result.isBest, false);
    assert.equal(r2.at(-1)!.result.title, '初来乍到');

    const q3 = (await c.post(`/places/${place.id}/quiz`, northOf(BUND, 3000))).body.quiz;
    const ans3 = await peekAnswers(q3.id);
    await play(c, q3, (i) => (i < 3 ? ans3[i]! : (ans3[i]! + 1) % 4));

    const board = (await b.get(`/places/${place.id}/quiz/board`)).body;
    assert.equal(board.players, 2);
    assert.deepEqual(board.board.map((e: { user: { nickname: string } }) => e.user.nickname), ['阿晴', '路人']);
    assert.equal(board.board[0].title, '此地知音');
    assert.equal(board.board[0].onSite, true);
    assert.equal(board.board[1].title, '老熟人');
    assert.equal(board.me, null);

    // 唱片架：阿晴打过卡也玩过；路人只玩过；小夏只打过卡
    const recA = (await a.get('/me/records')).body.records;
    assert.equal(recA.length, 1);
    assert.equal(recA[0].placeName, '江边步道');
    assert.equal(recA[0].visits, 1);
    assert.equal(recA[0].best.title, '此地知音');
    assert.ok(recA[0].moods.length >= 1);
    const recC = (await c.get('/me/records')).body.records;
    assert.equal(recC[0].visits, 0);
    const recB = (await b.get('/me/records')).body.records;
    assert.equal(recB[0].best, null);

    env.clock.advance(DAY);
    assert.equal((await c.get('/places/00000000-0000-4000-8000-000000000000/quiz/board')).status, 404);
  });
});

describe('此地知音：AI 出谜', () => {
  let fake: FakeLlm;
  beforeEach(async () => {
    fake = await startFakeLlm(500);
    env = await setup({ llm: fake.llm });
  });
  afterEach(async () => {
    await fake.close();
  });

  const reply = (emojiReply: string) =>
    fake.reply((body) => {
      const sys = body.messages[0].content as string;
      if (sys.includes('猜歌小游戏')) return emojiReply;
      if (sys.includes('声音画像')) return '{"summary":"江风里的老歌","keywords":["江风"]}';
      return '{"ok":true,"reason":""}';
    });

  it('大模型给出 emoji 谜面', async () => {
    reply('{"emoji":"☀️🌧️🎹","hint":"雨后的青春"}');
    const a = env.client((await env.newUser('阿晴')).token);
    const b = env.client((await env.newUser('小夏')).token);
    const { place } = await richPlace(a, b);
    const quiz = (await a.post(`/places/${place.id}/quiz`, BUND)).body.quiz;
    const emoji = quiz.rounds.find((r: { type: string }) => r.type === 'emoji');
    assert.equal(emoji.clue, '☀️🌧️🎹');
    assert.equal(emoji.hint, '雨后的青春');
    assert.equal(quiz.engine.kind, 'llm');
  });

  it('谜面泄露了歌名 / 含文字时退回规则谜面', async () => {
    reply('{"emoji":"晴天☀️","hint":"周杰伦的歌"}');
    const a = env.client((await env.newUser('阿晴')).token);
    const b = env.client((await env.newUser('小夏')).token);
    const { place } = await richPlace(a, b);
    const quiz = (await a.post(`/places/${place.id}/quiz`, BUND)).body.quiz;
    const emoji = quiz.rounds.find((r: { type: string }) => r.type === 'emoji');
    assert.match(emoji.hint, /^(歌名 \d+ 个字|外文歌名)/);
    assert.equal(quiz.engine.kind, 'rules');
  });

  it('大模型超时也能开局', async () => {
    fake.reply('hang');
    const a = env.client((await env.newUser('阿晴')).token);
    const b = env.client((await env.newUser('小夏')).token);
    await richPlace(a, b).catch(() => undefined); // 审核超时会放行
    const places = (await a.get(`/places/nearby?lat=${BUND.lat}&lng=${BUND.lng}`)).body.places;
    const res = await a.post(`/places/${places[0].id}/quiz`, BUND);
    assert.equal(res.status, 201);
    assert.equal(res.body.quiz.engine.kind, 'rules');
  });
});

describe('称号', () => {
  it('按答对比例', () => {
    assert.equal(titleFor(5, 5), '此地知音');
    assert.equal(titleFor(3, 5), '老熟人');
    assert.equal(titleFor(1, 5), '过客');
    assert.equal(titleFor(0, 5), '初来乍到');
  });
});

/** 测试专用：直接从数据库读出一局的答案。 */
async function peekAnswers(quizId: string): Promise<number[]> {
  const r = env.db.prepare('SELECT rounds FROM quizzes WHERE id = ?').get(quizId) as { rounds: string };
  return (JSON.parse(r.rounds) as { answer: number }[]).map((x) => x.answer);
}
