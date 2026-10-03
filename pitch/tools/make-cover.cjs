/**
 * 生成参赛封面图（4000×2500：左上赛事名，右上作品名与作者，右侧三台手机）。
 *   AUTHOR="张三" node pitch/tools/make-cover.cjs pitch/cover.png
 */
const { chromium } = require(require.resolve('playwright', { paths: [require('node:path').join(__dirname, '../../e2e')] }));
const fs = require('node:fs');
const path = require('node:path');

const out = process.argv[2] || path.join(__dirname, '..', 'cover.png');
const author = process.env.AUTHOR || '作者名';
const shot = (f) => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', 'screens', f)).toString('base64');

const phones = [
  ['10-place.jpg', '共鸣指纹 · 城市的节拍地图'],
  ['r1-locked.jpg', '对拍 · 定调：两根指针重合'],
  ['r2-scene.jpg', '入景 · AI 看画面调混音'],
];

const html = `<html><head><style>
*{margin:0;box-sizing:border-box}
body{width:4000px;height:2500px;overflow:hidden;background:#07080C;font-family:"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;color:#F4F5F7;position:relative}
.g1{position:absolute;left:-600px;top:-700px;width:2600px;height:2200px;border-radius:50%;background:radial-gradient(closest-side,rgba(183,243,107,.28),rgba(183,243,107,0))}
.g2{position:absolute;right:-500px;bottom:-900px;width:2800px;height:2400px;border-radius:50%;background:radial-gradient(closest-side,rgba(160,139,255,.30),rgba(160,139,255,0))}
.g3{position:absolute;left:1300px;top:900px;width:1600px;height:1400px;border-radius:50%;background:radial-gradient(closest-side,rgba(62,230,193,.14),rgba(62,230,193,0))}
.tl{position:absolute;left:230px;top:200px}
.tl .a{font-size:92px;font-weight:900;letter-spacing:-1px}
.tl .a b{background:linear-gradient(90deg,#A08BFF,#5CC8FF,#3EE6C1);-webkit-background-clip:text;color:transparent}
.tl .b{font-size:60px;font-weight:700;margin-top:10px;color:#E8EAF0}
.tr{position:absolute;right:230px;top:210px;text-align:right}
.tr .n{font-size:72px;font-weight:900}
.tr .by{font-size:64px;font-weight:800;margin-top:14px;color:#E8EAF0}
.title{position:absolute;left:230px;bottom:230px}
.mid{position:absolute;left:230px;top:720px;width:1500px;font-size:66px;line-height:1.55;color:#C9CDD8;font-weight:600}
.mid b{color:#F4F5F7}
.title .app{font-size:56px;font-weight:800;color:#A7ACB9;letter-spacing:4px;margin-bottom:10px}
.title h1{font-size:280px;line-height:1.05;font-weight:900;letter-spacing:6px;background:linear-gradient(90deg,#D2F76A,#7FF0A0,#3EE6C1);-webkit-background-clip:text;color:transparent}
.title p{font-size:64px;color:#C9CDD8;margin-top:20px}
.phones{position:absolute;right:230px;top:430px;display:flex;gap:110px}
.ph{width:640px}
.frame{width:640px;height:1386px;border-radius:96px;background:#000;padding:22px;border:4px solid rgba(255,255,255,.18);box-shadow:0 80px 200px rgba(0,0,0,.65),0 0 160px rgba(62,230,193,.10)}
.frame img{width:100%;height:100%;object-fit:cover;object-position:top;border-radius:76px;display:block}
.cap{margin-top:46px;font-size:46px;font-weight:800;color:#C9CDD8;text-align:center}
.ph:nth-child(2){margin-top:-60px}
.tags{display:flex;gap:28px;margin-top:56px}
.tag{font-size:44px;font-weight:900;padding:18px 40px;border-radius:999px;color:#07080C;background:linear-gradient(90deg,#A08BFF,#5CC8FF,#3EE6C1)}
.tag.l{background:linear-gradient(90deg,#D2F76A,#3EE6C1)}
</style></head><body>
<div class="g1"></div><div class="g2"></div><div class="g3"></div>
<div class="tl"><div class="a">Build With <b>AI</b></div><div class="b">腾讯音乐首届高校 AI Hackathon · 玩转音乐</div></div>
<div class="tr"><div class="n">《共鸣》</div><div class="by">by ${author}</div></div>
<div class="phones">${phones.map(([f, c]) => `<div class="ph"><div class="frame"><img src="${shot(f)}"/></div><div class="cap">${c}</div></div>`).join('')}</div>
<div class="mid">降噪把世界关在外面，<br/>通透把世界放进来——<br/><b>共鸣，让世界成为你这首歌的一部分。</b></div>
<div class="title"><div class="app">此地有歌 · MusicHere</div><h1>共鸣</h1><p>让世界为你的歌伴奏</p>
<div class="tags"><span class="tag l">对拍 · 跟上脚步</span><span class="tag">定调 · 落在环境的调上</span><span class="tag">入景 · AI 调混音</span></div></div>
</body></html>`;

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 4000, height: 2500 } });
  await p.setContent(html);
  await p.waitForTimeout(500);
  await p.screenshot({ path: out, type: out.endsWith('.jpg') ? 'jpeg' : 'png', ...(out.endsWith('.jpg') ? { quality: 90 } : {}) });
  await b.close();
  console.log('已生成', out);
})();
