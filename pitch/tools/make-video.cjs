/**
 * 把 e2e 录下的手机画面合成为 1920×1080 的演示视频：左侧是每一步的大字幕，右侧是手机画面，
 * 前后各有一张标题卡。字幕用 Chromium 渲染成图片（中文字体齐全），再用 ffmpeg 合成 H.264 MP4。
 * timeline.json 里的 audio（App 自己录下的「共鸣片段」：街头环境声 + 对拍后的音乐）按录制开始的时刻混进音轨。
 *
 *   VIDEO_DIR=... node e2e/smoke.cjs          # 先录屏，得到 webm + timeline.json
 *   FFMPEG=/path/to/ffmpeg node pitch/tools/make-video.cjs <VIDEO_DIR> <输出.mp4>
 */
const { chromium } = require(require.resolve('playwright', { paths: [require('node:path').join(__dirname, '../../e2e')] }));
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [videoDir, outFile] = process.argv.slice(2);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const { video, timeline, audio = [] } = JSON.parse(fs.readFileSync(path.join(videoDir, 'timeline.json'), 'utf8'));
const work = path.join(videoDir, 'frames');
fs.mkdirSync(work, { recursive: true });

const INTRO = 4;
const OUTRO = 6;

// 每一步的字幕：按 e2e 步骤名的开头匹配
const CAPTIONS = [
  ['欢迎页', '无需注册，一个昵称就开始', '此地有歌 —— 每个地方，都有它的背景音乐', false],
  ['此刻：识别', '打开就知道你在哪里', '当前地点的 AI 声音画像，和等你拾起的漂流瓶', true],
  ['此刻：换一首', '每一首推荐，都说得出理由', '理由全部来自真实数据：几个人在这里听、什么时段最常被点播、听众的原话', false],
  ['共鸣：听见', '共鸣：让世界为你的歌伴奏', '🔊 你听到的是 App 录下的真实片段：街上的脚步（112 BPM）+ 江上的嗡鸣（A）。原创曲《夜行》从 100 BPM 滑到 112，从 E 小调移到以 A 为属音的 D 小调——几秒后，鼓点踩在了脚步上', true],
  ['共鸣：入景', '入景：AI 看画面调混音', '拍一下眼前：画面的能量、明暗、情绪决定编配密度、音色明暗和大小调，地点类型决定混响空间', true],
  ['共鸣：留下', '共鸣指纹：城市的节拍地图', '每个地点「听起来」的拍子和调，由在场的人贡献（只存数字，不存声音）；下一个人来，歌一开始就在调上', false],
  ['听这里：一句话', '听这里：AI 读懂此刻', '光线、色彩、心情 → 情绪标签 → 从这里的人群记忆里挑歌', true],
  ['听这里：把 AI', 'AI 补位，解决冷启动', '新地点还没人分享？AI 先挑，一键留下，你就是第一个', true],
  ['听这里：拍一张', '照片直接交给多模态大模型', '未接入模型时，浏览器本地计算明暗冷暖，规则引擎兜底，功能不中断', true],
  ['声景雷达', '声景雷达', '附近哪里有歌，按真实方位和距离一目了然', false],
  ['地点：AI', '地点的「声音画像」', '情绪构成 × 24 小时热度 × 常被留下的艺人 —— 统计是真实的，措辞交给 AI', true],
  ['打卡', '到了现场，才能打开', '打卡后看到应景 / 常听 / 现场三类歌，并捡起陌生人留下的漂流瓶', false],
  ['此地知音', '此地知音：猜猜这里在听什么', 'AI 用 emoji 出谜；题目全部来自这里真实留下的歌、现场和留言。在现场答题 ×1.2，冲上知音榜', true],
  ['投漂流瓶', '声音漂流瓶', '把一首歌和一句话，留给下一个路过这里的人', true],
  ['现场', '街头艺人、即兴、演唱会都被记住', '「我也在听」累计常听热度；AI 审核拦下引流广告', true],
  ['地点页明信片', '声音明信片', '地点 × 一首歌 × AI 写的一句，一键保存分享，带来新用户', true],
  ['分享', '分享一首歌', '新建地点、配上照片，AI 帮你写下「为什么是这首」', true],
  ['我的', '唱片架：去过的地方都收进来', '每个地点一张唱片，贴纸颜色是那里的情绪；还有足迹和漂流瓶', false],
  ['离开现场', '位置是唯一的钥匙', '离开现场就无法打卡与投瓶 —— 内容真实，也防刷量', false],
];

const steps = timeline.filter((s) => s.name !== 'end' && !s.name.startsWith('无定位'));
const end = timeline.find((s) => s.name === 'end').t;

const PHONE = { x: 1262, y: 60, h: 960 };
const phoneW = Math.round((390 * PHONE.h) / 844 / 2) * 2;

const css = `
  *{margin:0;box-sizing:border-box} body{width:1920px;height:1080px;overflow:hidden;background:#07080C;
  font-family:"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;color:#F4F5F7;position:relative}
  .g1{position:absolute;left:-200px;top:-260px;width:1100px;height:900px;border-radius:50%;
    background:radial-gradient(closest-side,rgba(183,243,107,.20),rgba(183,243,107,0))}
  .g2{position:absolute;right:-160px;bottom:-300px;width:1100px;height:900px;border-radius:50%;
    background:radial-gradient(closest-side,rgba(160,139,255,.22),rgba(160,139,255,0))}
  .brand{position:absolute;left:120px;bottom:80px;font-size:26px;font-weight:800;color:#A7ACB9;letter-spacing:2px}
  .brand b{background:linear-gradient(90deg,#D2F76A,#3EE6C1);-webkit-background-clip:text;color:transparent}
  .bezel{position:absolute;left:${PHONE.x - 14}px;top:${PHONE.y - 14}px;width:${phoneW + 28}px;height:${PHONE.h + 28}px;
    border-radius:56px;background:#000;border:2px solid rgba(255,255,255,.16);box-shadow:0 40px 120px rgba(0,0,0,.6),0 0 80px rgba(62,230,193,.12)}
  .ai{display:inline-flex;align-items:center;gap:8px;padding:8px 18px;border-radius:999px;font-weight:900;font-size:24px;color:#07080C;
    background:linear-gradient(90deg,#A08BFF,#5CC8FF,#3EE6C1);margin-bottom:28px}
  .num{font-size:28px;font-weight:900;color:#B7F36B;letter-spacing:3px;margin-bottom:20px}
  h1{font-size:76px;font-weight:900;line-height:1.15;letter-spacing:-1px;max-width:980px}
  p{font-size:34px;line-height:1.6;color:#A7ACB9;margin-top:28px;max-width:1080px}
  .cap{position:absolute;left:120px;top:50%;transform:translateY(-55%)}
`;

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const render = async (file, body) => {
    await page.setContent(`<html><head><style>${css}</style></head><body><div class="g1"></div><div class="g2"></div>${body}</body></html>`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(work, file) });
  };

  await render(
    'intro.png',
    `<div class="cap" style="left:160px">
      <div class="num">BUILD WITH AI · 腾讯音乐首届高校 AI HACKATHON</div>
      <h1 style="font-size:120px">此地有歌</h1>
      <p style="font-size:44px;color:#F4F5F7">每个地方，都有它的背景音乐</p>
      <p>降噪把世界关在外面，通透把世界放进来——<br/>共鸣，让世界成为你这首歌的一部分</p>
    </div>`,
  );
  const list = [];
  list.push({ file: 'intro.png', d: INTRO });
  steps.forEach((s, i) => {
    const cap = CAPTIONS.find(([k]) => s.name.startsWith(k));
    const next = steps[i + 1]?.t ?? end;
    const file = `step${String(i).padStart(2, '0')}.png`;
    list.push({ file, d: Math.max(0.5, next - s.t), cap, i });
  });
  for (const item of list.slice(1)) {
    const [, title, sub, ai] = item.cap ?? ['', '', '', false];
    await render(
      item.file,
      `<div class="bezel"></div>
       <div class="cap">
         ${ai ? '<div class="ai">✦ AI</div>' : ''}
         <div class="num">${String(item.i + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}</div>
         <h1>${title}</h1><p>${sub}</p>
       </div>
       <div class="brand"><b>此地有歌</b> · MusicHere</div>`,
    );
  }
  // 片头之后、第一个步骤之前的空档（录屏开头）用第一步的画面补齐
  list[1].d += steps[0].t;
  await render(
    'outro.png',
    `<div class="cap" style="left:160px">
      <div class="num">此地有歌 · MUSICHERE</div>
      <h1 style="max-width:1600px">让世界为你的歌伴奏</h1>
      <p style="max-width:1600px">✦ 对拍：跟上脚步、车轮、街头艺人的节奏　✦ 定调：落在环境的调上　✦ 入景：AI 看画面调混音<br/>
      共鸣指纹 · 共鸣片段 · AI 读懂此刻 · 声音画像 · 漂流瓶 · 一键跳转 QQ 音乐</p>
    </div>`,
  );
  list.push({ file: 'outro.png', d: OUTRO });
  await browser.close();

  const concat = list.map((x) => `file '${path.join(work, x.file)}'\nduration ${x.d.toFixed(3)}`).join('\n') + `\nfile '${path.join(work, 'outro.png')}'\n`;
  fs.writeFileSync(path.join(work, 'bg.txt'), concat);

  const total = list.reduce((a, x) => a + x.d, 0);
  const clips = audio.filter((a) => fs.existsSync(a.file));
  const audioInputs = clips.flatMap((a) => ['-i', a.file]);
  const audioFilter = clips.length
    ? ';' +
      clips.map((a, i) => `[${i + 2}:a]aresample=48000,adelay=${Math.round((INTRO + a.t) * 1000)}:all=1[a${i}]`).join(';') +
      `;${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0,alimiter=limit=0.89,apad[aout]`
    : '';
  execFileSync(
    FFMPEG,
    [
      '-y',
      '-f', 'concat', '-safe', '0', '-i', path.join(work, 'bg.txt'),
      '-i', video,
      ...audioInputs,
      '-filter_complex',
      `[0:v]fps=30,format=yuv420p,setsar=1[bg];` +
        `[1:v]scale=${phoneW}:${PHONE.h}:flags=lanczos,setpts=PTS-STARTPTS+${INTRO}/TB[ph];` +
        `[bg][ph]overlay=${PHONE.x}:${PHONE.y}:eof_action=pass:enable='between(t,${INTRO},${(total - OUTRO).toFixed(2)})'[v]` +
        audioFilter,
      '-map', '[v]',
      ...(clips.length ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '160k'] : []),
      '-t', total.toFixed(2),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      outFile,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  console.log(`已生成 ${outFile}（${total.toFixed(1)} 秒）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
