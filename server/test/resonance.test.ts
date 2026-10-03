import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { BUND, createPlace, northOf, setup, type TestEnv } from './helpers.ts';

let env: TestEnv;
beforeEach(async () => {
  env = await setup();
});
afterEach(async () => {
  await env.close();
});

const print = (extra: Record<string, unknown> = {}) => ({ ...BUND, bpm: 112, confidence: 0.7, source: 'mic', tonic: 9, mode: 'drone', ...extra });

describe('共鸣指纹', () => {
  it('没有记录时返回空摘要', async () => {
    const a = env.client((await env.newUser()).token);
    const place = await createPlace(a);
    const res = await a.get(`/places/${place.id}/resonance`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.resonance, { count: 0, bpm: null, tonic: null, mode: null, keyShare: 0, contributors: 0, lastAt: null });
  });

  it('只能在现场贡献；主音与调式要成对出现；数值有范围', async () => {
    const a = env.client((await env.newUser()).token);
    const place = await createPlace(a);
    const far = await a.post(`/places/${place.id}/resonance`, print(northOf(BUND, 900)));
    assert.equal(far.status, 403);
    assert.equal(far.body.error, 'too_far');
    assert.equal((await a.post(`/places/${place.id}/resonance`, print({ mode: undefined }))).status, 400);
    assert.equal((await a.post(`/places/${place.id}/resonance`, print({ bpm: 400 }))).status, 400);
    assert.equal((await a.post(`/places/${place.id}/resonance`, print({ source: 'radio' }))).status, 400);
    const ok = await a.post(`/places/${place.id}/resonance`, print());
    assert.equal(ok.status, 201);
    assert.equal(ok.body.resonance.count, 1);
    assert.equal(ok.body.resonance.bpm, 112);
    assert.equal(ok.body.resonance.tonic, 9);
    assert.equal(ok.body.resonance.mode, 'drone');
  });

  it('多人汇总：速度取（折叠到同一八度后的）中位数，调取多数；同一人 10 分钟内只记一次', async () => {
    const users = await Promise.all(['a', 'b', 'c', 'd'].map((n) => env.newUser(n)));
    const [a, b, c, d] = users.map((u) => env.client(u.token));
    const place = await createPlace(a!);
    await a!.post(`/places/${place.id}/resonance`, print({ bpm: 110 }));
    await a!.post(`/places/${place.id}/resonance`, print({ bpm: 150 })); // 10 分钟内重复，不记
    await b!.post(`/places/${place.id}/resonance`, print({ bpm: 57, source: 'motion' })); // 慢一倍的脚步 = 114
    await c!.post(`/places/${place.id}/resonance`, print({ bpm: 112, tonic: 2, mode: 'major' }));
    const res = (await d!.post(`/places/${place.id}/resonance`, print({ bpm: 120, tonic: undefined, mode: undefined }))).body.resonance;
    assert.equal(res.count, 4);
    assert.equal(res.contributors, 4);
    assert.equal(res.bpm, 113); // 110, 112, 114, 120 的中位数
    assert.equal(res.tonic, 9);
    assert.equal(res.mode, 'drone');
    assert.equal(res.keyShare, 0.67);

    env.clock.advance(11 * 60_000);
    const again = (await a!.post(`/places/${place.id}/resonance`, print({ bpm: 112 }))).body.resonance;
    assert.equal(again.count, 5);
  });
});
