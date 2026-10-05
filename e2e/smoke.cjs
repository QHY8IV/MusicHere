/**
 * 端到端冒烟测试：用无头 Chromium 打开 app 的 web 版，模拟手机尺寸、GPS 定位和麦克风（一段合成的街头环境声：
 * 112 BPM 的脚步 + A 音的发动机嗡鸣），对着真实后端走一遍核心流程：
 *   登录 → 此刻（推荐理由 / 换一首 / 点赞）
 *   → 共鸣（对拍到 112 BPM、定调到以 A 为属音的 D 小调、录片段、AI 入景、留下共鸣指纹）
 *   → 跑步（合成的 170 步/分 加速度：自动挑歌、节拍引导、锁到脚步、合拍率）
 *   → 声景（模拟的 Open-Meteo 小雨 + 步子 + 嗡鸣 → 生成式声景，录片段）
 *   → 听这里（一句话 & 照片，AI 场景理解，留下 AI 推荐）
 *   → 声景雷达 → 地点（AI 声音画像、打卡捡漂流瓶、此地知音猜歌、投漂流瓶、现场、留言与审核、明信片）
 *   → 分享（新地点 + 照片 + 帮我写）→ 我的（唱片架、漂流瓶）→ 离开现场 → 无定位时用示例位置
 *
 * 前置：后端运行在 :3000，并已用 `npm run seed -- --lat 31.24 --lng 121.49` 生成示例数据（全新数据库）；
 *       web 版（EXPO_PUBLIC_DEMO_LOCATION=31.24,121.49）已导出并由静态服务器托管在 WEB_URL（默认 :8081）。
 * 每次运行都会写入数据，重跑前请重置数据库。
 *
 * 环境变量：WEB_URL、CHROMIUM_PATH、E2E_OUT（截图目录）、VIDEO_DIR（设置后放慢节奏并录制演示视频）、
 *           E2E_DB（后端数据库路径；设置后「此地知音」按剧本作答——除第 2 题外全答对，否则全选 A）
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { streetWav } = require('./street-sound.cjs');

const WEB_URL = process.env.WEB_URL || 'http://localhost:8081/';
const OUT = process.env.E2E_OUT || path.join(__dirname, 'out');
const VIDEO_DIR = process.env.VIDEO_DIR;
const PHOTO = path.join(__dirname, '..', 'server', 'seed-images', 'park.jpg');
const SUNSET = path.join(__dirname, '..', 'server', 'seed-images', 'riverside.jpg');
fs.mkdirSync(OUT, { recursive: true });
const STREET = streetWav(path.join(OUT, 'street.wav'), { bpm: 112, droneHz: 110, seconds: 24 });
const MEDIA_ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${STREET}`,
  '--autoplay-policy=no-user-gesture-required',
];

const HERE = { latitude: 31.24, longitude: 121.49, accuracy: 20 };
const FAR = { latitude: 31.24 + 900 / 111195, longitude: 121.49, accuracy: 20 }; // 正北约 900 米，离所有示例地点都较远

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', ...MEDIA_ARGS],
    ...(VIDEO_DIR ? { slowMo: 260 } : {}),
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    geolocation: HERE,
    permissions: ['geolocation', 'microphone'],
    locale: 'zh-CN',
    acceptDownloads: true,
    ...(VIDEO_DIR ? { recordVideo: { dir: VIDEO_DIR, size: { width: 390, height: 844 } } } : {}),
  });
  // 天气：固定成「小雨 17°C、风 14 km/h」，测试不依赖外网
  await ctx.route('https://api.open-meteo.com/**', (r) =>
    r.fulfill({ json: { current: { temperature_2m: 17.4, precipitation: 0.8, weather_code: 61, wind_speed_10m: 14, is_day: 1 } } }),
  );
  const page = await ctx.newPage();
  const t0 = Date.now();
  /** 录视频时记录每一步开始的时间点，用来给成片配字幕；audio 是要混进成片的声音片段 */
  const timeline = [];
  const audio = [];
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });

  const pause = (ms) => (VIDEO_DIR ? page.waitForTimeout(ms * 1.7) : Promise.resolve());
  const step = async (name, fn) => {
    timeline.push({ name, t: (Date.now() - t0) / 1000 });
    try {
      await fn();
      console.log('✔', name);
    } catch (e) {
      console.log('✘', name, '\n   ', e.message.split('\n')[0]);
      await page.screenshot({ path: `${OUT}/fail-${name.replace(/[^\w一-龥]+/g, '_')}.png` });
      throw e;
    }
  };
  const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
  // 页面栈里会有隐藏的屏幕，交互只针对可见元素
  const V = (id) => page.locator(`[data-testid=${id}]:visible`);
  const visibleText = (t) => page.getByText(t).filter({ visible: true }).first();
  const toast = (re) => page.getByTestId('toast').filter({ hasText: re }).waitFor();
  const scroll = async (px) => {
    await page.mouse.move(195, 420);
    await page.mouse.wheel(0, px);
    await page.waitForTimeout(VIDEO_DIR ? 700 : 300);
  };
  const digits = (s) => Number(String(s).replace(/\D/g, ''));

  await page.goto(WEB_URL);

  await step('欢迎页：空昵称被拦下，输入后进入', async () => {
    await page.getByText('每个地方，都有它的背景音乐').waitFor();
    await shot('01-welcome');
    await pause(1200);
    await page.getByTestId('start').click();
    await page.getByTestId('welcome-error').waitFor();
    await page.getByTestId('nickname').fill('测试员');
    await page.getByTestId('start').click();
  });

  await step('此刻：识别当前地点、AI 画像摘要、漂流瓶提示、带理由的推荐', async () => {
    await V('current-place').waitFor();
    assert.equal(await V('current-place').innerText(), '江边步道');
    await V('bottle-teaser').waitFor();
    assert.match(await V('bottle-teaser').innerText(), /3 个漂流瓶/);
    await V('go-resonance').waitFor();
    await V('now-reason').waitFor();
    assert.ok((await V('now-reason').innerText()).length > 4, '推荐理由不应为空');
    await page.waitForTimeout(600);
    await shot('02-now');
    await pause(1500);
  });

  await step('此刻：换一首、点赞（推荐权重提高）', async () => {
    const before = await V('now-title').innerText();
    await V('now-next').click();
    await page.waitForFunction((b) => document.querySelector('[data-testid=now-title]')?.innerText !== b, before);
    const like = V('now-like');
    const n0 = digits(await like.innerText());
    await like.click();
    await toast(/推荐权重提高/);
    assert.equal(digits(await V('now-like').innerText()), n0 + 1);
    await scroll(800);
    await shot('03-now-memory');
    await pause(1200);
    await scroll(-800);
  });

  await step('共鸣：听见周围的拍子与调，歌曲对拍、定调（同时录下 15 秒片段）', async () => {
    await page.goto(new URL('/resonance', WEB_URL).toString());
    await V('res-start').waitFor();
    await V('song-night').click();
    await page.mouse.move(195, 420);
    await page.mouse.wheel(0, -3000);
    await page.waitForTimeout(400);
    await shot('r0-resonance');
    await pause(1500);
    await V('res-start').click();
    await V('res-record').click();
    audio.push({ t: (Date.now() - t0) / 1000, file: path.join(OUT, 'resonance-clip.webm') });
    // 录制的 15 秒里一直看着可视化：两根指针慢慢重合
    await page.mouse.move(195, 420);
    await page.mouse.wheel(0, -3000);
    await V('res-readout').filter({ hasText: '已对拍' }).waitFor({ timeout: 20000 });
    const bpm = Number((await V('res-beat-status').innerText()).match(/环境 ([\d.]+) BPM/)[1]);
    assert.ok(Math.abs(bpm - 112) < 3, `应识别出约 112 BPM，实际 ${bpm}`);
    const key = await V('res-key-status').innerText();
    assert.match(key, /持续的 A 音/);
    assert.match(key, /D 小调/, '夜行（E 小调）应移到以 A 为属音的 D 小调');
    // 速度追上环境、相位收敛到 20 ms 以内
    await page.waitForFunction(() => {
      const vis = (id) => [...document.querySelectorAll(`[data-testid=${id}]`)].find((e) => e.offsetParent);
      const ph = vis('res-readout')?.innerText.match(/相位差 (\d+) ms/);
      const bpm = vis('res-beat-status')?.innerText.match(/环境 ([\d.]+) BPM → 歌曲 (\d+) BPM/);
      return ph && Number(ph[1]) <= 20 && bpm && Math.abs(Number(bpm[1]) - Number(bpm[2])) <= 1.5;
    }, null, { timeout: 15000 });
    await shot('r1-locked');
    await V('res-audio').waitFor({ timeout: 20000 });
    await V('res-download').scrollIntoViewIfNeeded();
    const [download] = await Promise.all([page.waitForEvent('download'), V('res-download').click()]);
    assert.match(download.suggestedFilename(), /^musichere-resonance-\d{12}\.(webm|ogg|m4a)$/);
    await download.saveAs(audio[0].file);
    assert.ok(fs.statSync(audio[0].file).size > 20000, '片段应有内容');
    await pause(800);
  });

  await step('共鸣：入景——拍一下，AI 按画面调混响、明暗与编配', async () => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), V('res-scene-photo').click()]);
    await chooser.setFiles(SUNSET);
    await V('res-scene-status').filter({ hasText: '混响' }).waitFor();
    await V('res-scene').scrollIntoViewIfNeeded();
    await shot('r2-scene');
    await pause(1800);
  });

  await step('共鸣：留下这里的共鸣指纹', async () => {
    await V('res-save-print').scrollIntoViewIfNeeded();
    await V('res-save-print').click();
    await toast(/已把这里的拍子留在「江边步道」/);
    assert.match(await V('res-print-value').innerText(), /^11\d BPM · A 嗡鸣$/);
    await shot('r3-print');
    await pause(1500);
    await V('res-stop').click();
  });

  await step('跑步：数出步频、自动挑歌、节拍引导，再锁到脚步上', async () => {
    // 合成的跑步加速度：170 步 / 分，每一步一个落地冲击
    await page.evaluate(() => {
      const period = 60000 / 170;
      const t0 = performance.now();
      window.__runner = setInterval(() => {
        const ph = ((performance.now() - t0) % period) / period;
        const y = 9.8 + (ph < 0.12 ? 7 * Math.exp(-ph * 30) : 0) + (Math.random() - 0.5) * 0.3;
        window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: 0.2, y, z: 0.4 }, interval: 16 }));
      }, 16);
    });
    await page.mouse.move(195, 420);
    await page.mouse.wheel(0, -3000);
    await V('res-mode-run').click();
    await V('run-target-180').click();
    await V('res-start').click();
    await V('run-guide').filter({ hasText: '节拍引导' }).waitFor({ timeout: 15000 });
    const cad = digits(await V('run-cadence').innerText());
    assert.ok(Math.abs(cad - 170) <= 4, `步频应约 170，实际 ${cad}`);
    assert.match(await V('run-guide').innerText(), /音乐比你的步子快 3%，带你从 1\d\d 提到 180/);
    await V('song-sprint').filter({ hasText: '最合拍' }).waitFor({ timeout: 10000 });
    await V('run-panel').scrollIntoViewIfNeeded();
    await shot('m1-run-guide');
    await pause(1800);
    await V('run-target-follow').click();
    await V('run-guide').filter({ hasText: '已锁到你的脚步' }).waitFor({ timeout: 10000 });
    await page.waitForFunction(() => {
      const el = [...document.querySelectorAll('[data-testid=run-onbeat]')].find((e) => e.offsetParent);
      return el && Number(el.innerText.replace('%', '')) >= 80;
    }, null, { timeout: 25000 });
    await shot('m2-run-locked');
    await pause(1800);
    await V('res-stop').click();
  });

  await step('声景：时间 + 天气 + 步子 + 环境嗡鸣 → 实时生成的声景（录 10 秒）', async () => {
    await page.mouse.move(195, 420);
    await page.mouse.wheel(0, -3000);
    await V('res-mode-scape').click();
    await V('scape-walk').click();
    await V('res-start').click();
    await V('scape-weather').filter({ hasText: '雨 17°C' }).waitFor();
    await V('scape-inputs').filter({ hasText: '持续的 A 音' }).waitFor({ timeout: 15000 });
    await V('scape-inputs').filter({ hasText: /1\d\d 步 \/ 分 → 脉冲跟着走/ }).waitFor({ timeout: 15000 });
    const why = await V('scape-why').innerText();
    assert.match(why, /雨声层/);
    assert.match(why, /有轻柔的脉冲/);
    await V('res-record').click();
    audio.push({ t: (Date.now() - t0) / 1000, file: path.join(OUT, 'scape-clip.webm') });
    await V('scape-inputs').scrollIntoViewIfNeeded();
    await shot('m3-scape');
    await pause(2500);
    await V('scape-why').scrollIntoViewIfNeeded();
    await pause(2000);
    await V('res-audio').waitFor({ timeout: 20000 });
    await V('res-download').scrollIntoViewIfNeeded();
    const [download] = await Promise.all([page.waitForEvent('download'), V('res-download').click()]);
    assert.match(download.suggestedFilename(), /^musichere-scape-\d{12}\.(webm|ogg|m4a)$/);
    await download.saveAs(audio[audio.length - 1].file);
    await page.evaluate(() => clearInterval(window.__runner));
    await V('res-stop').click();
  });

  await step('听这里：一句话 + 快捷心情 → AI 场景理解与带理由的推荐', async () => {
    await page.getByTestId('tab-index').click();
    await V('ai-cta').click();
    await V('scene-go').waitFor();
    await shot('04-listen');
    await pause(1000);
    await V('scene-text').fill('下班路过江边，晚霞很好看');
    await page.getByRole('button', { name: '一个人走走' }).click();
    await V('scene-go').click();
    await V('scene-card').waitFor();
    assert.match(await V('engine-badge').innerText(), /AI/);
    assert.match(await V('scene-summary').innerText(), /江边步道/);
    assert.ok((await V('pick-crowd').count()) >= 1, '应有来自人群记忆的推荐');
    assert.ok((await V('pick-ai').count()) >= 1, '应有 AI 新发现');
    await page.waitForTimeout(400);
    await shot('05-scene');
    await pause(1500);
    await scroll(700);
    await shot('06-scene-picks');
    await pause(1500);
  });

  await step('听这里：把 AI 新发现留在这里；生成明信片', async () => {
    const title = await V('pick-ai-title').first().innerText();
    await V('pick-keep').first().click();
    await toast(new RegExp(`已把《${title}》留在|已经在这里了`));
    await V('scene-postcard').click();
    await V('postcard-line').filter({ hasNotText: '正在为这里写' }).waitFor();
    await page.waitForTimeout(500);
    await shot('07-postcard');
    await pause(1500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    // 弹层可能正在淡出：还在就点关闭，已经消失就算了
    const close = page.getByRole('button', { name: '关闭' }).filter({ visible: true });
    if (await close.count()) await close.first().click({ timeout: 3000 }).catch(() => {});
    await V('scene-again').waitFor();
  });

  if (!VIDEO_DIR) await step('听这里：拍一张照片（浏览器里计算画面明暗冷暖）', async () => {
    await V('scene-again').click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), V('scene-pick').click()]);
    await chooser.setFiles(SUNSET);
    await V('scene-photo').waitFor();
    await pause(800);
    const req = page.waitForRequest((r) => r.url().includes('/api/ai/scene'));
    await V('scene-go').click();
    const body = JSON.parse((await req).postData());
    assert.ok(body.image && body.image.length > 1000, '照片以 base64 发给服务端');
    assert.ok(body.colorHint && typeof body.colorHint.brightness === 'number', '附带画面色调线索');
    await V('scene-card').waitFor();
    await shot('08-scene-photo');
    await pause(1500);
  });

  await step('声景雷达：附近地点按方位展示', async () => {
    await page.getByTestId('tab-places').click();
    await V('radar').waitFor();
    await page.waitForTimeout(600);
    await shot('09-radar');
    await pause(1500);
    assert.ok((await page.getByTestId('screen-places').getByTestId('place-card').count()) >= 5);
    await scroll(700); // 让地点卡片离开底部悬浮 Tab 栏
  });

  await step('地点：AI 声音画像（情绪构成、最热闹时段）', async () => {
    await page.getByTestId('screen-places').getByTestId('place-card').filter({ hasText: '江边步道' }).first().click();
    await V('place-name-title').filter({ hasText: '江边步道' }).waitFor();
    await shot('10-place');
    await pause(1200);
    await V('persona-summary').waitFor();
    assert.match(await V('persona-card').innerText(), /最热闹/);
    assert.match(await V('place-print').innerText(), /11\d BPM · A 嗡鸣/);
    if (VIDEO_DIR) {
      await scroll(650);
      await pause(2200);
      await scroll(500);
      await pause(1500);
      await scroll(-1150);
    }
  });

  await step('打卡：显示三类歌曲并捡到漂流瓶', async () => {
    await V('checkin').click();
    await V('bottle-reveal').waitFor();
    assert.ok((await V('bottle-message').innerText()).length > 5);
    await page.waitForTimeout(400);
    await shot('11-bottle');
    await pause(2000);
    await V('bottle-keep').click();
    await V('checkin-done').waitFor();
    await pause(1500);
    const txt = await V('checkin-done').innerText();
    assert.match(txt, /应景/);
    assert.match(txt, /常听/);
    assert.match(txt, /现场/);
    assert.match(txt, /《海阔天空》/);
  });

  if (!VIDEO_DIR) await step('此地知音：AI 出谜猜歌、逐题揭晓冷知识、现场加成、知音榜', async () => {
    await V('quiz-card').scrollIntoViewIfNeeded();
    await pause(1200);
    const started = page.waitForResponse((r) => r.url().includes('/quiz') && r.request().method() === 'POST');
    await V('quiz-start').click();
    const { quiz } = await (await started).json();
    assert.equal(quiz.rounds.length, 5);
    assert.equal(quiz.onSite, true);
    let answers = null;
    if (process.env.E2E_DB) {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.env.E2E_DB, { readOnly: true });
      answers = JSON.parse(db.prepare('SELECT rounds FROM quizzes WHERE id = ?').get(quiz.id).rounds).map((r) => r.answer);
      db.close();
    }
    for (let i = 0; i < 5; i++) {
      await V('quiz-prompt').waitFor();
      assert.equal(await V('quiz-prompt').innerText(), quiz.rounds[i].prompt);
      if (quiz.rounds[i].type === 'emoji') {
        await V('quiz-clue').waitFor();
        await page.waitForTimeout(600); // 等弹层滑入完成
        await shot('q1-quiz-emoji');
      }
      await pause(1400);
      const choice = answers ? (i === 1 ? (answers[i] + 1) % 4 : answers[i]) : 0;
      await V(`quiz-option-${choice}`).click();
      await V('quiz-reveal').waitFor();
      assert.ok((await V('quiz-fact').innerText()).length > 6, '揭晓时要有这里的冷知识');
      if (i === 0) {
        await page.waitForTimeout(700); // 等揭晓卡片的动画
        await shot('q2-quiz-reveal');
      }
      if (i === 1 && answers) assert.match(await V('quiz-reveal').innerText(), /差一点/);
      await pause(1600);
      await V('quiz-next').click();
    }
    await V('quiz-result').waitFor();
    const title = await V('quiz-title').innerText();
    assert.match(title, /此地知音|老熟人|过客|初来乍到/);
    if (answers) assert.equal(title, '老熟人');
    await V('quiz-board').getByText('测试员').waitFor();
    await page.waitForTimeout(600);
    await shot('q3-quiz-result');
    await pause(2200);
    await V('quiz-done').click();
    await V('quiz-card').getByText(/你的最好成绩/).waitFor();
  });

  await step('投漂流瓶：帮我写一句 + 投放', async () => {
    await V('throw-open').click();
    await V('bottle-title').fill('晴天');
    await V('bottle-artist').fill('周杰伦');
    await page.getByRole('button', { name: '帮我写' }).filter({ visible: true }).click();
    await page.waitForFunction(() => {
      const el = [...document.querySelectorAll('[data-testid=bottle-message-input]')].find((e) => e.offsetParent);
      return el && el.value.includes('晴天');
    });
    await shot('12-throw');
    await pause(1200);
    await V('bottle-submit').click();
    await toast(/漂流瓶已投出/);
    await pause(1000);
  });

  if (!VIDEO_DIR) await step('现场 / 常听 / 留言（审核拦截广告）', async () => {
    await scroll(1200);
    await V('tab-live').click();
    await visibleText('江边吉他大叔').waitFor();
    await shot('13-live');
    await pause(1200);
    await V('tab-frequent').click();
    await V('listen').first().click();
    await toast(/常听/);
    await V('tab-comments').click();
    await V('comment-input').fill('加微信 abc123 领福利');
    await V('post-comment').click();
    await toast(/未通过审核/);
    await V('comment-input').fill('傍晚的江风配这些歌刚刚好');
    await page.getByRole('button', { name: '治愈' }).filter({ visible: true }).click();
    await V('post-comment').click();
    await toast(/留言已发布/);
    await pause(1200);
    assert.equal(await V('comment-body').first().innerText(), '傍晚的江风配这些歌刚刚好');
    await shot('14-comments');
  });

  if (!VIDEO_DIR) await step('地点页明信片：保存为图片（PNG）', async () => {
    await scroll(-3000);
    await V('postcard-open').click();
    await V('postcard-line').filter({ hasNotText: '正在为这里写' }).waitFor();
    await pause(1500);
    const [download] = await Promise.all([page.waitForEvent('download'), V('postcard-save').click()]);
    const file = path.join(OUT, 'postcard.png');
    await download.saveAs(file);
    const head = fs.readFileSync(file).subarray(0, 8);
    assert.deepEqual([...head], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], '应是 PNG');
    await page.getByRole('button', { name: '关闭' }).filter({ visible: true }).first().click();
  });

  if (!VIDEO_DIR) await step('分享：新地点 + 照片 + 帮我写 + 现场歌曲', async () => {
    await page.goto(new URL('/add', WEB_URL).toString());
    await V('submit-song').waitFor();
    await V('new-place').click();
    await V('place-name').fill('测试角落');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), V('cover-library').click()]);
    await chooser.setFiles(PHOTO);
    await V('cover-preview').waitFor();
    await V('kind-live').click();
    await V('submit-song').click();
    await V('form-error').waitFor();
    await V('song-title-input').fill('起风了');
    await V('song-artist-input').fill('买辣椒也用券');
    await V('help-write').click();
    await page.waitForFunction(() => {
      const el = [...document.querySelectorAll('[data-testid=song-note-input]')].find((e) => e.offsetParent);
      return el && el.value.length > 3;
    });
    await page.getByRole('button', { name: '街头艺人' }).filter({ visible: true }).click();
    await page.getByPlaceholder('乐队 / 艺人 / 街头歌手').fill('地铁口歌手');
    await shot('15-share');
    await pause(1200);
    await V('submit-song').click();
    await V('place-name-title').filter({ hasText: '测试角落' }).waitFor();
    await page.locator('[data-testid=place-cover-image]:visible img').first().waitFor({ state: 'attached' });
    assert.match(
      await page.locator('[data-testid=place-cover-image]:visible img').first().getAttribute('src'),
      /\/api\/uploads\/[0-9a-f-]{36}\.jpg/,
    );
    await V('tab-live').click();
    await visibleText('地铁口歌手').waitFor();
  });

  await step('我的：唱片架、足迹与漂流瓶', async () => {
    await page.goto(new URL('/me', WEB_URL).toString());
    await V('nickname-display').waitFor();
    assert.equal(await V('nickname-display').innerText(), '测试员');
    await V('record-item').first().waitFor();
    assert.match(await V('record-item').first().innerText(), /江边步道[\s\S]*老熟人|江边步道[\s\S]*\d+/);
    await scroll(400);
    await shot('q4-me-records');
    await pause(1500);
    await scroll(-400);
    await V('me-trail').click();
    await visibleText('江边步道').waitFor();
    await V('me-bottles').click();
    await V('bottle-letter').first().waitFor();
    await V('thrown-bottle').first().waitFor();
    assert.match(await V('thrown-bottle').first().innerText(), /漂流中/);
    await shot('16-me-bottles');
    await pause(1500);
  });

  await step('离开现场：打卡与投瓶不可用，不会向服务端发打卡请求', async () => {
    await ctx.setGeolocation(FAR);
    await page.goto(new URL('/places', WEB_URL).toString());
    await V('radar').waitFor();
    await scroll(700);
    await page.getByTestId('screen-places').getByTestId('place-card').filter({ hasText: '江边步道' }).first().click();
    await V('place-name-title').waitFor();
    await visibleText(/进入 \d+ 米范围内即可打卡/).waitFor();
    let posted = false;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/checkin')) posted = true;
    });
    await pause(1500);
    assert.equal(await V('checkin').getAttribute('aria-disabled'), 'true');
    assert.equal(await V('throw-open').getAttribute('aria-disabled'), 'true');
    await V('checkin').click({ force: true }); // 模拟用户硬点禁用按钮
    await page.waitForTimeout(500);
    assert.equal(posted, false);
  });

  timeline.push({ name: 'end', t: (Date.now() - t0) / 1000 });
  const video = page.video();
  await ctx.close();
  if (VIDEO_DIR && video) {
    fs.writeFileSync(path.join(VIDEO_DIR, 'timeline.json'), JSON.stringify({ video: await video.path(), timeline, audio }, null, 2));
  }
  await browser.close().catch(() => {});

  // 没有定位权限的访客：可以一键用示例位置体验（演示站 / http 页面）
  const browser2 = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'],
  });
  const ctx2 = await browser2.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  await step('无定位权限：使用示例位置体验', async () => {
    await p2.goto(WEB_URL);
    await p2.getByTestId('nickname').fill('访客');
    await p2.getByTestId('start').click();
    await p2.locator('[data-testid=use-demo-location]:visible').click();
    await p2.locator('[data-testid=current-place]:visible').waitFor();
    await p2.getByText('示例位置').filter({ visible: true }).first().waitFor();
  });
  await browser2.close();

  // 4xx 是测试里故意触发的（例如被审核拦下的广告留言），浏览器会把它记成资源加载失败；
  // 真正的服务端错误（5xx）由上面的 response 监听单独记录。
  const real = problems.filter((p) => !/favicon|DevTools|geolocation|status of 4\d\d/i.test(p));
  if (real.length) {
    console.log('\n运行期问题:\n' + real.join('\n'));
    process.exitCode = 1;
  } else console.log('\n全部通过，无控制台错误');
})().catch((e) => {
  console.error('E2E 失败:', e.message);
  process.exit(1);
});
