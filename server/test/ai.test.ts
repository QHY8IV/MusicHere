import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { z } from 'zod';
import { extractJson, LlmError } from '../src/ai/llm.ts';
import { inferMoods, moodSimilarity, uniqMoods } from '../src/ai/moods.ts';
import { ruleCheck } from '../src/ai/moderation.ts';
import { backgroundIdle } from '../src/ai/tags.ts';
import { localHour, peakWindow, timeLabel, windowLabel } from '../src/ai/time.ts';
import { BUND, createPlace, HOUR, northOf, PNG, setup, startFakeLlm, type FakeLlm, type TestEnv } from './helpers.ts';

describe('情绪词表与规则', () => {
  it('从文字推断情绪', () => {
    assert.deepEqual(inferMoods('下着小雨，一个人走在江边').slice(0, 3).sort(), ['伤感', '孤独', '静谧'].sort());
    assert.ok(inferMoods('日落时分吹着晚风').includes('浪漫'));
    assert.deepEqual(inferMoods(''), []);
    assert.deepEqual(inferMoods('今天吃了一碗面'), []);
  });

  it('相似度：相同为 1，相近 > 相反', () => {
    assert.equal(moodSimilarity(['浪漫'], ['浪漫']), 1);
    assert.ok(moodSimilarity(['惬意'], ['治愈']) > moodSimilarity(['惬意'], ['热血']));
    assert.equal(moodSimilarity([], ['浪漫']), 0);
  });

  it('uniqMoods 过滤词表外的词并去重', () => {
    assert.deepEqual(uniqMoods(['浪漫', '开心', '浪漫', '夜色'], 3), ['浪漫', '夜色']);
  });

  it('时区与时段', () => {
    // UTC 10:00 = 上海 18:00
    assert.equal(localHour(new Date('2026-06-01T10:00:00Z'), 'Asia/Shanghai'), 18);
    assert.equal(timeLabel(18), '黄昏');
    assert.equal(timeLabel(2), '深夜');
    assert.equal(windowLabel(18), '黄昏 18–20 点');
    const hours = new Array(24).fill(0);
    hours[18] = 3;
    hours[19] = 4;
    hours[9] = 1;
    assert.equal(peakWindow(hours), 18);
    assert.equal(peakWindow(new Array(24).fill(0)), null);
  });

  it('审核规则：拦截引流与联系方式，放行正常表达', () => {
    assert.ok(ruleCheck('加微信 abc123 送福利'));
    assert.ok(ruleCheck('联系我 13812345678'));
    assert.ok(ruleCheck('QQ: 12345678'));
    assert.ok(ruleCheck('看这里 https://spam.example'));
    assert.equal(ruleCheck('这首歌在江边听太好哭了'), null);
    assert.equal(ruleCheck('2026 年 6 月的夏天'), null);
  });
});

describe('大模型客户端', () => {
  let fake: FakeLlm;
  beforeEach(async () => {
    fake = await startFakeLlm(300);
  });
  afterEach(async () => {
    await fake.close();
  });
  const schema = z.object({ a: z.number() });

  it('兼容 ```json 代码块与前后的解释文字', () => {
    assert.deepEqual(extractJson('好的：\n```json\n{"a":1}\n```\n希望有帮助'), { a: 1 });
    assert.deepEqual(extractJson('结果是 {"a": 2} 。'), { a: 2 });
    assert.throws(() => extractJson('没有 JSON'), LlmError);
  });

  it('带上鉴权头与模型名；图片时使用视觉模型', async () => {
    fake.reply('{"a":1}');
    assert.deepEqual(await fake.llm.json(schema, [{ role: 'user', content: 'hi' }]), { a: 1 });
    await fake.llm.json(schema, [{ role: 'user', content: 'hi' }], { vision: true });
    assert.equal(fake.requests[0]!.auth, 'Bearer test-key');
    assert.equal(fake.requests[0]!.body.model, 'text-model');
    assert.equal(fake.requests[1]!.body.model, 'vision-model');
  });

  it('结构不符、HTTP 错误、超时都抛 LlmError（由调用方降级）', async () => {
    fake.reply('{"b":1}');
    await assert.rejects(fake.llm.json(schema, [{ role: 'user', content: 'x' }]), LlmError);
    fake.reply({ status: 500 });
    await assert.rejects(fake.llm.json(schema, [{ role: 'user', content: 'x' }]), LlmError);
    fake.reply('hang');
    await assert.rejects(fake.llm.json(schema, [{ role: 'user', content: 'x' }]), /超时/);
  });
});

/** 在 BUND 建一个地点并放几首歌（不同情绪），返回地点 id。 */
async function seedRiverside(env: TestEnv) {
  const owner = env.client((await env.newUser('阿晴')).token);
  const place = await createPlace(owner, '江边步道', BUND, { category: 'street' });
  await owner.post(`/places/${place.id}/songs`, { title: '后来', artist: '刘若英', kind: 'vibe', note: '下雨天一个人听' });
  await owner.post(`/places/${place.id}/songs`, { title: '告白气球', artist: '周杰伦', kind: 'vibe', note: '和喜欢的人散步' });
  await owner.post(`/places/${place.id}/songs`, {
    title: '海阔天空',
    artist: 'Beyond',
    kind: 'live',
    eventType: 'busker',
    performer: '江边吉他大叔',
  });
  return place.id;
}

describe('AI 听这里（规则引擎）', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setup();
  });
  afterEach(async () => {
    await env.close();
  });

  it('文字描述决定情绪；人群记忆里情绪匹配的歌排在前面，并附真实理由', async () => {
    await seedRiverside(env);
    const me = env.client((await env.newUser()).token);
    const res = await me.post('/ai/scene', { text: '下着小雨，一个人走在江边', lat: BUND.lat, lng: BUND.lng, hour: 21 });
    assert.equal(res.status, 200);
    assert.equal(res.body.engine.kind, 'rules');
    assert.ok(res.body.scene.moods.includes('伤感'), JSON.stringify(res.body.scene));
    assert.equal(res.body.place.name, '江边步道');
    assert.equal(res.body.coldStart, false);

    const first = res.body.picks[0];
    assert.equal(first.source, 'crowd');
    assert.equal(first.placeSong.song.title, '后来', '情绪最匹配的应排第一');
    assert.ok(first.matched.includes('伤感'));
    assert.match(first.reason, /契合此刻/);

    const live = res.body.picks.find((p: any) => p.placeSong?.song.title === '海阔天空');
    assert.match(live.reason, /江边吉他大叔曾在这里现场演出/);
    // 至少有一个 AI 补位
    assert.ok(res.body.picks.some((p: any) => p.source === 'ai'));
    assert.ok(res.body.picks.length <= 5);
  });

  it('冷启动：附近没有任何分享时，全部由 AI 从曲库挑选', async () => {
    const me = env.client((await env.newUser()).token);
    const res = await me.post('/ai/scene', { text: '和朋友在公园野餐，阳光很好', lat: 10, lng: 10, hour: 15 });
    assert.equal(res.body.coldStart, true);
    assert.equal(res.body.place, null);
    assert.ok(res.body.picks.length >= 3);
    assert.ok(res.body.picks.every((p: any) => p.source === 'ai' && p.song.title && p.reason));
  });

  it('画面色调参与判断：很暗的照片 → 夜色', async () => {
    const me = env.client((await env.newUser()).token);
    const res = await me.post('/ai/scene', {
      colorHint: { brightness: 0.1, warmth: 0, saturation: 0.3 },
      lat: 10,
      lng: 10,
      hour: 14,
    });
    assert.ok(res.body.scene.moods.includes('夜色'));
    assert.ok(res.body.scene.tags.includes('夜色低光'));
  });

  it('校验：非图片的 base64 被拒；hour 越界被拒', async () => {
    const me = env.client((await env.newUser()).token);
    const bad = await me.post('/ai/scene', { image: Buffer.from('not an image').toString('base64'), lat: 1, lng: 1, hour: 3 });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'invalid_image');
    assert.equal((await me.post('/ai/scene', { lat: 1, lng: 1, hour: 24 })).status, 400);
  });

  it('帮我写一句：规则模板包含歌名与地点', async () => {
    const placeId = await seedRiverside(env);
    const me = env.client((await env.newUser()).token);
    const res = await me.post('/ai/caption', { placeId, title: '晴天', artist: '周杰伦', hour: 18 });
    assert.equal(res.status, 200);
    assert.match(res.body.text, /晴天/);
    assert.equal(res.body.engine.kind, 'rules');
  });

  it('引擎状态', async () => {
    const me = env.client((await env.newUser()).token);
    assert.deepEqual((await me.get('/ai/status')).body, { engine: { kind: 'rules', label: '本地规则引擎' } });
  });
});

describe('AI 听这里（大模型）', () => {
  let env: TestEnv;
  let fake: FakeLlm;
  beforeEach(async () => {
    fake = await startFakeLlm(500);
    env = await setup({ llm: fake.llm });
  });
  afterEach(async () => {
    await env.close();
    await fake.close();
  });

  const sceneReply = JSON.stringify({
    summary: '江面映着晚霞，风里有人在弹吉他',
    moods: ['浪漫', '自由', '不存在的情绪'],
    tags: ['晚霞', '江风'],
    energy: 0.5,
    valence: 0.7,
    songs: [
      { title: '日落大道', artist: '梁博', why: '晚霞配公路感' },
      { title: '海阔天空', artist: 'Beyond', why: '和这里的现场呼应' },
    ],
  });

  it('看图：用视觉模型，图片以 data URL 传入；结果标注引擎；过滤词表外情绪；与人群推荐去重', async () => {
    await seedRiverside(env);
    fake.reply((body) => (body.messages[0].content.includes('场景音乐编辑') ? sceneReply : '{"moods":["浪漫"]}'));
    const me = env.client((await env.newUser()).token);
    const res = await me.post('/ai/scene', { image: PNG.toString('base64'), lat: BUND.lat, lng: BUND.lng, hour: 18 });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.engine, { kind: 'llm', label: '测试模型' });
    assert.equal(res.body.scene.summary, '江面映着晚霞，风里有人在弹吉他');
    assert.deepEqual(res.body.scene.moods, ['浪漫', '自由']);

    const sceneReq = fake.requests.find((r) => r.body.messages[0].content.includes('场景音乐编辑'))!;
    assert.equal(sceneReq.body.model, 'vision-model');
    const parts = sceneReq.body.messages[1].content;
    assert.match(parts[1].image_url.url, /^data:image\/png;base64,/);
    assert.match(parts[0].text, /江边步道/, '把地点与人群记忆作为上下文交给模型');

    const ai = res.body.picks.filter((p: any) => p.source === 'ai');
    assert.ok(ai.some((p: any) => p.song.title === '日落大道' && p.reason === '晚霞配公路感'));
    // 海阔天空已在人群推荐里出现，AI 的同名推荐要去重
    const titles = res.body.picks.map((p: any) => p.placeSong?.song.title ?? p.song.title);
    assert.equal(titles.filter((t: string) => t === '海阔天空').length, 1);
  });

  it('模型返回垃圾或超时 → 自动降级为规则引擎，接口照常返回', async () => {
    fake.reply('我不知道');
    const me = env.client((await env.newUser()).token);
    const res = await me.post('/ai/scene', { text: '深夜下班的地铁口', lat: 10, lng: 10, hour: 23 });
    assert.equal(res.status, 200);
    assert.equal(res.body.engine.kind, 'rules');
    assert.ok(res.body.picks.length > 0);

    fake.reply('hang');
    const res2 = await me.post('/ai/scene', { text: '深夜下班的地铁口', lat: 10, lng: 10, hour: 23 });
    assert.equal(res2.status, 200);
    assert.equal(res2.body.engine.kind, 'rules');
  });

  it('内容审核：模型判定不适合则拒绝；模型故障时放行', async () => {
    const u = env.client((await env.newUser()).token);
    const place = await createPlace(u);
    fake.reply('{"ok":false,"reason":"人身攻击"}');
    const bad = await u.post(`/places/${place.id}/comments`, { body: '某某是个xx' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'content_rejected');
    assert.match(bad.body.message, /人身攻击/);

    fake.reply({ status: 503 });
    const ok = await u.post(`/places/${place.id}/comments`, { body: '晚上来很舒服' });
    assert.equal(ok.status, 201);
  });

  it('帮我写一句：使用模型输出', async () => {
    fake.reply('{"text":"晚风把歌吹到了江对岸"}');
    const me = env.client((await env.newUser()).token);
    const res = await me.post('/ai/caption', { title: '晴天', artist: '周杰伦', hour: 18 });
    assert.deepEqual(res.body, { text: '晚风把歌吹到了江对岸', engine: { kind: 'llm', label: '测试模型' } });
  });
});

describe('地点声音画像', () => {
  let env: TestEnv;
  let fake: FakeLlm | null = null;
  afterEach(async () => {
    await env.close();
    await fake?.close();
    fake = null;
  });

  it('规则：统计情绪构成、最热闹时段、常见艺人；无数据时给出邀请', async () => {
    env = await setup();
    const placeId = await seedRiverside(env);
    // 时钟：UTC 12:00 = 上海 20:00；在 20 点附近打卡几次
    for (let i = 0; i < 4; i++) {
      const v = env.client((await env.newUser()).token);
      await v.post(`/places/${placeId}/checkin`, BUND);
    }
    const me = env.client((await env.newUser()).token);
    const res = await me.get(`/places/${placeId}/persona`);
    assert.equal(res.status, 200);
    const p = res.body.persona;
    assert.equal(p.engine.kind, 'rules');
    assert.match(p.summary, /^江边步道听起来是/);
    assert.ok(p.moods.length >= 2);
    const shareSum = p.moods.reduce((a: number, m: any) => a + m.share, 0);
    assert.ok(shareSum > 0.5 && shareSum <= 1.01, `情绪占比之和 ${shareSum}`);
    assert.ok(p.moods.every((m: any, i: number) => i === 0 || p.moods[i - 1].share >= m.share), '按占比降序');
    assert.ok(p.peak && [19, 20].includes(p.peak.startHour), JSON.stringify(p.peak));
    assert.equal(p.hours.length, 24);
    assert.equal(p.counts.songs, 3);
    assert.equal(p.counts.live, 1);
    assert.equal(p.counts.visitors, 4);
    assert.ok(p.topArtists.length > 0);

    const empty = await createPlace(me, '空地', northOf(BUND, 3000));
    const e = (await me.get(`/places/${empty.id}/persona`)).body.persona;
    assert.match(e.summary, /等你留下第一首/);
    assert.equal(e.peak, null);
  });

  it('大模型：用模型措辞；数据不变时命中缓存不重复调用，数据变化后重新生成', async () => {
    fake = await startFakeLlm(500);
    env = await setup({ llm: fake.llm });
    fake.reply((body) =>
      String(body.messages[0].content).includes('声音画像')
        ? '{"summary":"傍晚的江风里，人们跟着吉他合唱","keywords":["江风","合唱","黄昏"]}'
        : '{"moods":["浪漫"]}',
    );
    const placeId = await seedRiverside(env);
    await backgroundIdle(); // 等后台的 AI 打标签完成，否则情绪数据会在两次请求之间变化
    const me = env.client((await env.newUser()).token);
    const count = () => fake!.requests.filter((r) => String(r.body.messages[0].content).includes('声音画像')).length;

    const a = (await me.get(`/places/${placeId}/persona`)).body.persona;
    assert.equal(a.engine.kind, 'llm');
    assert.equal(a.summary, '傍晚的江风里，人们跟着吉他合唱');
    assert.deepEqual(a.keywords, ['江风', '合唱', '黄昏']);
    await me.get(`/places/${placeId}/persona`);
    assert.equal(count(), 1, '数据没变，应命中缓存');

    env.clock.advance(HOUR);
    await me.post(`/places/${placeId}/checkin`, BUND);
    await me.get(`/places/${placeId}/persona`);
    assert.equal(count(), 2, '有新打卡，应重新生成');
  });
});
