/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COOL_END,
  control,
  coolTempo,
  DropTracker,
  phaseAt,
  SIM,
  simInit,
  simStep,
  type Phase,
} from '../src/lib/resonance/rabbit';

const plan = SIM.plan(168);

/** 理想估计（没有估计延迟）下把整个模拟跑一遍 */
function runSim(rabbit: boolean) {
  const dt = 0.1;
  const tr = new DropTracker(plan.target);
  let s = simInit();
  let coolStart: number | null = null;
  const trace: { t: number; c: number; music: number; phase: Phase; dropped: boolean }[] = [];
  for (let t = 0; t < SIM.finishAt + plan.cooldown + 1; t += dt) {
    const phase = phaseAt(t, plan, SIM.finishAt);
    if (phase === 'cooldown' && coolStart === null) coolStart = s.cadence;
    tr.update(t, s.cadence, phase);
    const ctl = control(phase, s.cadence, plan, rabbit ? tr : new DropTracker(plan.target), coolStart === null ? null : { startCadence: coolStart, progress: (t - SIM.finishAt) / plan.cooldown });
    s = simStep(s, t, dt, ctl.music, phase, plan);
    trace.push({ t, c: s.cadence, music: ctl.music, phase, dropped: tr.state === 'dropped' });
  }
  return { tr, trace };
}

describe('兔子电台：阶段与冷却', () => {
  it('阶段按时间推进，收工后进入冷却再结束', () => {
    assert.equal(phaseAt(3, plan, null), 'warmup');
    assert.equal(phaseAt(20, plan, null), 'pace');
    assert.equal(phaseAt(20, plan, 20), 'cooldown');
    assert.equal(phaseAt(20 + plan.cooldown, plan, 20), 'done');
  });

  it('冷却：从当前步频线性降到 120，不越界', () => {
    assert.equal(coolTempo(168, 0), 168);
    assert.equal(coolTempo(168, 1), COOL_END);
    assert.equal(coolTempo(168, 2), COOL_END);
    assert.ok(coolTempo(168, 0.5) < 168 && coolTempo(168, 0.5) > COOL_END);
  });
});

describe('兔子电台：掉速状态机', () => {
  it('抬一下脚不算掉速，持续 2 秒才算', () => {
    const tr = new DropTracker(168);
    tr.update(0, 168, 'pace'); // 先上线
    tr.update(0.5, 168, 'pace');
    tr.update(1, 168, 'pace');
    tr.update(1.5, 160, 'pace');
    tr.update(3, 168, 'pace');
    assert.equal(tr.drops, 0);
    tr.update(4, 160, 'pace');
    tr.update(6.1, 160, 'pace');
    assert.equal(tr.drops, 1);
    assert.equal(tr.events[0]!.at, 4);
  });

  it('回到目标附近并稳住 2 秒才算被带回来，并记下用了多久', () => {
    const tr = new DropTracker(168);
    tr.update(-1, 168, 'pace');
    tr.update(0, 160, 'pace');
    tr.update(2, 160, 'pace');
    assert.equal(tr.state, 'dropped');
    tr.update(5, 167, 'pace');
    tr.update(6, 167, 'pace');
    assert.equal(tr.state, 'dropped');
    tr.update(7.1, 167, 'pace');
    assert.equal(tr.state, 'steady');
    assert.equal(tr.recoveries, 1);
    assert.ok(Math.abs(tr.events[0]!.recoveredIn! - 5) < 1e-9);
  });

  it('爬坡阶段（还没到过目标）不算掉速', () => {
    const tr = new DropTracker(168);
    for (let t = 0; t < 10; t += 0.5) tr.update(t, 150, 'pace');
    assert.equal(tr.drops, 0);
    assert.equal(tr.armed, false);
  });

  it('热身和冷却里不判掉速', () => {
    const tr = new DropTracker(168);
    for (let t = 0; t < 20; t += 0.5) tr.update(t, 140, 'warmup');
    for (let t = 20; t < 40; t += 0.5) tr.update(t, 140, 'cooldown');
    assert.equal(tr.drops, 0);
  });
});

describe('兔子电台：控制', () => {
  it('没掉速时锁在脚步上；掉速后领先但不超过 3%', () => {
    const tr = new DropTracker(168);
    assert.equal(control('pace', 167, plan, tr, null).lock, true);
    tr.update(-1, 168, 'pace');
    tr.update(0, 160, 'pace');
    tr.update(2, 160, 'pace');
    const c = control('pace', 160, plan, tr, null);
    assert.equal(c.lock, false);
    assert.ok(c.lead > 0 && c.lead <= 0.03 + 1e-9, `lead ${c.lead}`);
    assert.ok(c.music > 160);
  });

  it('冷却时音乐比脚步慢', () => {
    const tr = new DropTracker(168);
    const c = control('cooldown', 168, plan, tr, { startCadence: 168, progress: 0.5 });
    assert.equal(c.lock, false);
    assert.ok(c.lead < 0);
  });
});

describe('兔子电台：模拟跑者的整次跑（模型，不是实测）', () => {
  it('有兔子：掉速被检测到、被带回来，冷却时步频随音乐降下去', () => {
    const { tr, trace } = runSim(true);
    assert.ok(tr.drops >= 2, `掉速 ${tr.drops} 次`);
    assert.equal(tr.recoveries, tr.drops, '每次掉速都被带回');
    assert.ok(tr.avgRecovery! < 15, `平均 ${tr.avgRecovery} 秒`);
    const pace = trace.filter((x) => x.phase === 'pace');
    assert.ok(Math.min(...pace.map((x) => x.c)) > plan.target - 12, '没有掉得太深');
    const end = trace[trace.length - 1]!;
    assert.ok(end.c < 135, `冷却结束步频 ${end.c}`);
  });

  it('对照：没有兔子（只跟随），同一个模型里步频会一路掉下去', () => {
    const { trace } = runSim(false);
    const withRabbit = runSim(true).trace;
    const at = (tr: typeof trace) => tr.find((x) => x.t >= 29.9)!.c;
    assert.ok(at(trace) < at(withRabbit) - 3, `无兔子 ${at(trace)} vs 有兔子 ${at(withRabbit)}`);
  });
});
