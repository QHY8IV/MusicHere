/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { guideTempo, onBeat, onBeatRate, pickSongForCadence, stretchCost } from '../src/lib/resonance/run';
import { nextChord, parseWeather, planScape } from '../src/lib/resonance/scape';
import { SONGS } from '../src/lib/resonance/songs';

describe('跑步：按步频选歌', () => {
  it('170 步 / 分 → 172 BPM 的《冲线》（一步一拍，几乎不用伸缩）', () => {
    assert.equal(pickSongForCadence(170, SONGS).id, 'sprint');
  });
  it('慢跑 168 → 仍是《冲线》；快走 120 → 120 BPM 的《下一站》；散步 100 → 《夜行》', () => {
    assert.equal(pickSongForCadence(168, SONGS).id, 'sprint');
    assert.equal(pickSongForCadence(120, SONGS).id, 'station');
    assert.equal(pickSongForCadence(100, SONGS).id, 'night');
  });
  it('两步一拍可以用，但同等伸缩下优先一步一拍', () => {
    const riverside = SONGS.find((s) => s.id === 'riverside')!;
    const sprint = SONGS.find((s) => s.id === 'sprint')!;
    assert.ok(stretchCost(168, riverside) > stretchCost(168, sprint));
    assert.ok(stretchCost(168, riverside) < 0.05); // 84 × 2 = 168，本身也很合适
  });
});

describe('跑步：节拍引导', () => {
  it('离目标远时音乐最多领先 3%，不锁相位', () => {
    const g = guideTempo(150, 170);
    assert.equal(g.arrived, false);
    assert.ok(Math.abs(g.tempo - 154.5) < 1e-9);
    assert.ok(Math.abs(g.lead - 0.03) < 1e-9);
  });
  it('差距在 2 步以内算到达，锁到脚步上', () => {
    assert.deepEqual(guideTempo(169, 170), { tempo: 169, arrived: true, lead: 0 });
  });
  it('目标比现在慢也能往下带；没有目标就跟随', () => {
    const g = guideTempo(180, 165);
    assert.ok(g.lead < 0 && g.lead >= -0.03);
    assert.deepEqual(guideTempo(160, null), { tempo: 160, arrived: true, lead: 0 });
  });
});

describe('跑步：合拍率', () => {
  const P = 60 / 172; // 一拍
  it('一步一拍：落在拍点 ±60 ms 内算踩上', () => {
    assert.equal(onBeat(10 + 3 * P + 0.04, 10, P, 1), true);
    assert.equal(onBeat(10 + 3 * P + 0.09, 10, P, 1), false);
  });
  it('两步一拍（ratio 0.5）：拍点之间的那一步也算', () => {
    const songP = 60 / 84;
    assert.equal(onBeat(10 + songP * 2.5, 10, songP, 0.5), true);
    assert.equal(onBeat(10 + songP * 2.25, 10, songP, 0.5), false);
  });
  it('至少 8 步才给合拍率，只看最近 32 步', () => {
    assert.equal(onBeatRate([true, true, true]), null);
    assert.equal(onBeatRate([...new Array(40).fill(false), ...new Array(24).fill(true), ...new Array(8).fill(false)]), 0.75);
  });
});

describe('声景：天气解析', () => {
  it('Open-Meteo 的小雨', () => {
    const w = parseWeather({ current: { temperature_2m: 18.2, precipitation: 0.6, weather_code: 61, wind_speed_10m: 14, is_day: 1 } });
    assert.ok(w);
    assert.equal(w.label, '雨');
    assert.ok(w.rain >= 0.35);
    assert.ok(Math.abs(w.wind - 0.35) < 1e-9);
    assert.equal(w.isDay, true);
  });
  it('晴天没有雨；格式不对返回 null', () => {
    assert.equal(parseWeather({ current: { temperature_2m: 25, weather_code: 0, is_day: 1 } })!.rain, 0);
    assert.equal(parseWeather({}), null);
    assert.equal(parseWeather(null), null);
    assert.equal(parseWeather({ current: { weather_code: 'x' } }), null);
  });
});

describe('声景：输入 → 规划', () => {
  it('清晨明亮、深夜小调更暗；入睡没有节拍且更慢', () => {
    const morning = planScape('focus', 7, null);
    const night = planScape('focus', 23, null);
    assert.equal(morning.key.mode, 'major');
    assert.equal(night.key.mode, 'minor');
    assert.ok(morning.brightness > night.brightness);
    const sleep = planScape('sleep', 23, null);
    assert.equal(sleep.pulse, 0);
    assert.ok(sleep.bpm < morning.bpm);
    assert.ok(sleep.breath);
  });
  it('大雨让白天的声景转小调、更暗，并加入雨声层', () => {
    const dry = planScape('walk', 14, { rain: 0, wind: 0, temp: 20, label: '晴', isDay: true });
    const wet = planScape('walk', 14, { rain: 0.8, wind: 0.5, temp: 12, label: '雨', isDay: true });
    assert.equal(dry.key.mode, 'major');
    assert.equal(wet.key.mode, 'minor');
    assert.ok(wet.brightness < dry.brightness);
    assert.equal(wet.rain, 0.8);
    assert.ok(wet.why.some((w) => w.includes('雨')));
  });
  it('冷天用玻璃音色，热天用温暖的铺底', () => {
    assert.equal(planScape('focus', 14, { rain: 0, wind: 0, temp: 3, label: '晴', isDay: true }).pad, 'glass');
    assert.equal(planScape('focus', 14, { rain: 0, wind: 0, temp: 30, label: '晴', isDay: true }).pad, 'warm');
  });
  it('和弦游走只走顺阶和弦', () => {
    let c = 1;
    let r = 0.1;
    const rnd = () => (r = (r * 9301 + 49297) % 233280 / 233280);
    for (let i = 0; i < 200; i++) {
      c = nextChord(c, false, rnd);
      assert.ok([1, 2, 4, 5, 6].includes(c));
    }
  });
});
