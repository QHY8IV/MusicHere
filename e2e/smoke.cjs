/**
 * 端到端冒烟测试：用无头 Chromium 打开 app 的 web 版，模拟手机尺寸和 GPS 定位，
 * 对着真实后端走一遍核心流程：
 *   登录 → 此刻（推荐理由 / 换一首 / 点赞）→ 听这里（一句话 & 照片，AI 场景理解，留下 AI 推荐）
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

const WEB_URL = process.env.WEB_URL || 'http://localhost:8081/';
const OUT = process.env.E2E_OUT || path.join(__dirname, 'out');
const VIDEO_DIR = process.env.VIDEO_DIR;
const PHOTO = path.join(__dirname, '..', 'server', 'seed-images', 'park.jpg');
const SUNSET = path.join(__dirname, '..', 'server', 'seed-images', 'riverside.jpg');
fs.mkdirSync(OUT, { recursive: true });

const HERE = { latitude: 31.24, longitude: 121.49, accuracy: 20 };
const FAR = { latitude: 31.24 + 900 / 111195, longitude: 121.49, accuracy: 20 }; // 正北约 900 米，离所有示例地点都较远

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'],
    ...(VIDEO_DIR ? { slowMo: 260 } : {}),
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    geolocation: HERE,
    permissions: ['geolocation'],
    locale: 'zh-CN',
    acceptDownloads: true,
    ...(VIDEO_DIR ? { recordVideo: { dir: VIDEO_DIR, size: { width: 390, height: 844 } } } : {}),
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  /** 录视频时记录每一步开始的时间点，用来给成片配字幕 */
  const timeline = [];
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
    await V('go-quiz').waitFor();
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

  await step('听这里：一句话 + 快捷心情 → AI 场景理解与带理由的推荐', async () => {
    await page.getByTestId('tab-listen').click();
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

  await step('听这里：拍一张照片（浏览器里计算画面明暗冷暖）', async () => {
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

  await step('此地知音：AI 出谜猜歌、逐题揭晓冷知识、现场加成、知音榜', async () => {
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

  await step('现场 / 常听 / 留言（审核拦截广告）', async () => {
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

  await step('地点页明信片：保存为图片（PNG）', async () => {
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

  await step('分享：新地点 + 照片 + 帮我写 + 现场歌曲', async () => {
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
    fs.writeFileSync(path.join(VIDEO_DIR, 'timeline.json'), JSON.stringify({ video: await video.path(), timeline }, null, 2));
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
