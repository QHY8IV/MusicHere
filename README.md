# MusicHere 🎵

> 每个地方，都有它的背景音乐。

路过一个很有氛围的地方，把此刻最配的那首歌留在这里；别人走到这里时，会随机听到前人留下的歌。

## 功能

| 需求 | 实现 |
| --- | --- |
| ① 觉得很应景的歌，上传到这个场景 | 「分享」页，类型选 **应景** |
| ② 记录这里人们常听的歌 | 类型 **常听**；任何人在这里点「我也在听」都会累计热度（近 30 天、按人去重） |
| ③ 在这里听到过的歌：演唱会 / 即兴 / 街头艺人 | 类型 **现场**，记录演出类型、演出者、演出名称、日期。来源分两种：**用户上传** 和 **官方记录**（管理员接口批量导入，界面上带「官方记录」徽标） |
| 按定位随机推荐前人听过的歌 | 「发现」页：以当前定位为中心，对附近地点的所有歌做加权随机抽样，「换一批」可重抽 |
| 打卡地点 | 地点页「在这里打卡」，服务端校验你确实在现场；打卡成功后展示该地点 **应景 / 常听 / 现场** 三类歌曲 |
| 点赞等改变推荐权重 | 每条歌曲可 **点赞 / 点踩 / 我也在听**，直接改变它的排序和被推荐的概率 |
| 地点背景图 | 每个地点以一张图片作背景（发现页、地点列表、地点详情）。新建地点时可拍照 / 选相册，之后在地点页也能补或换封面；没有图的地点用按地点固定的渐变色兜底。官方导入可直接给图片外链 |
| 地点评论 | 地点页「评论」：文字 + 心情标签 + 可关联这里的一首歌，评论本身也可点赞 |

## 目录

```
app/      手机端（Expo / React Native / TypeScript，iOS + Android + Web 预览）
server/   后端 API（Node + Fastify + SQLite）
e2e/      端到端冒烟测试（Playwright，对着真实后端和 web 版跑）
```

## 快速开始

需要 Node.js ≥ 22.13（后端使用内置的 `node:sqlite`，无需编译原生模块）。

### 1. 启动后端

```bash
cd server
npm install
npm run seed -- --lat <你的纬度> --lng <你的经度>   # 在你所在位置周围生成示例地点和歌曲（可选，强烈建议）
npm run dev                                         # http://localhost:3000
```

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `DB_PATH` | `musichere.db` | SQLite 文件路径 |
| `ADMIN_KEY` | 空 | 设置后才会开启官方记录导入接口（见下） |
| `WEB_DIR` | 空 | 设置为 web 构建目录后，由后端直接托管页面（单页应用回退 + 静态资源长缓存） |
| `UPLOAD_DIR` | `uploads` | 用户上传的地点图片存放目录（需要持久化；生产环境建议换成对象存储 / CDN） |

### 2. 启动手机端

```bash
cd app
npm install
npx expo start
```

- 手机装 **Expo Go** 扫码即可（手机和电脑需在同一局域网）。App 会自动把后端地址推断为「开发机 IP:3000」。
- 模拟器：按 `i`（iOS）/ `a`（Android）；Android 模拟器自动使用 `10.0.2.2:3000`。
- 浏览器预览：按 `w`。浏览器会向你请求定位权限。
- 后端在别处（线上或不同端口）时，设置 `EXPO_PUBLIC_API_URL`，见 `app/.env.example`。

> 定位是核心：没有授权定位时，发现 / 地点 / 分享页会引导你授权。示例数据只出现在 `seed` 时指定的坐标附近，所以请用你自己的坐标来 seed，否则在家里什么也看不到。

### 3. 导入官方记录（可选）

```bash
ADMIN_KEY=my-secret npm run dev   # 在 server/ 下
curl -X POST localhost:3000/api/admin/import \
  -H 'x-admin-key: my-secret' -H 'content-type: application/json' -d '{
  "records": [{
    "place": { "name": "音乐厅广场", "lat": 31.24, "lng": 121.49, "category": "venue", "imageUrl": "https://example.com/hall.jpg" },
    "songs": [{
      "kind": "live", "title": "月光奏鸣曲", "artist": "贝多芬",
      "eventType": "concert", "performer": "市交响乐团",
      "eventTitle": "夏夜露天音乐会", "eventAt": "2026-07-01"
    }]
  }]
}'
```

导入是幂等的（同一地点同一首歌不会重复），且整批要么全成功要么全回滚。

## 部署演示站（Linux 服务器）

一个 Node 进程同时提供 API 和 web 页面（端口 80），用 systemd 托管。在**你自己的电脑**上执行：

```bash
./deploy/deploy.sh root@<服务器IP>
```

它会：构建 web 版 → 打包 → `scp` 上传 → 在服务器上安装 Node 22（如缺）、`npm ci`、首次部署导入示例数据（上海外滩一带）、注册并启动 `musichere` 服务。可重复运行用来升级，数据库和用户上传的图片会保留（数据在 `/var/lib/musichere`）。

- 请先配好 SSH 密钥（`ssh-copy-id root@<IP>`），**不要把密码写进脚本或命令行**。也建议改用普通用户 + sudo，而不是 root 直连。
- 云服务器还需要在控制台的**安全组**放行入方向 TCP 80。国内服务器如果用域名访问 80/443，需要 ICP 备案；直接用 IP 访问不受影响。
- **浏览器只在 HTTPS（或 localhost）下允许网页读取定位**，所以纯 `http://IP` 访问时访客拿不到位置。演示站构建时开启了 `EXPO_PUBLIC_DEMO_LOCATION`，此时页面上会出现“使用示例位置体验（上海外滩）”按钮，访客不在上海也能体验完整流程。要让真实定位可用，请在前面加一层 HTTPS（例如装 Caddy：`caddy reverse-proxy --from your.domain --to :80`，需要域名解析到服务器）。
- 修改示例坐标：`DEMO_LOCATION=纬度,经度 ./deploy/deploy.sh …`（页面兜底位置）和服务器上的 `DEMO_LAT` / `DEMO_LNG`（首次导入示例数据的位置）。
- 查看日志：`journalctl -u musichere -f`；重启：`systemctl restart musichere`。
- 脚本在本机用模拟的 ssh / systemd 完整跑通过（构建 → 打包 → 安装依赖 → 导入数据 → 启动 → 健康检查，并用浏览器验证）；“自动安装 Node”和真实 systemd 托管这两段只能在真实服务器上验证。

## 推荐是怎么工作的

一条「地点 × 歌曲 × 关系」记录的**权重**（`server/src/ranking.ts`）：

```
权重 = 类型基础值 × 来源加成 × 点赞项 × 在听项 × 新鲜度

点赞项   = (1 + ln(1 + 赞)) / (1 + 0.6 × 踩)      赞取对数，刷赞边际递减；踩直接压低
在听项   = 1 + 0.5 × ln(1 + 近30天在听人数)        主要影响「常听」
新鲜度   = 0.6 + 0.4 × 0.5^(年龄/1年)              会衰减，但不低于 0.6：老歌在这里依然成立
来源加成 = 官方 ×1.5；类型：现场 ×1.15，其余 ×1
```

- **地点页**里按权重降序展示。
- **发现页**把附近（默认 300 米）所有记录按「权重 × 距离衰减」做加权无放回随机抽样（Efraimidis–Spirakis），所以高赞、官方、离得近的更容易出现，但每次刷新都不同。
- 发现页会排除：你自己上传的、你点过踩的、被多人点踩且远多于赞的；同一首歌只出现一次。被屏蔽的歌仍可在地点页看到并重新点赞翻盘。

## API 概览

所有接口前缀 `/api`，除 `/health`、`/auth/guest` 外需 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/guest` | 访客注册，返回 `token` |
| GET / PATCH | `/me` | 我的资料与统计 / 改昵称 |
| GET | `/me/checkins`、`/me/songs` | 我的足迹 / 我分享的歌 |
| GET | `/discover?lat&lng&radius&limit` | 按定位随机推荐 + 当前所在地点 |
| GET | `/places/nearby?lat&lng&radius` | 附近地点 |
| POST | `/places` | 新建地点（200 米内同名自动合并） |
| GET | `/places/:id` | 地点详情（含 `imageUrl`、`canSetImage`） |
| POST | `/places/:id/image` | 上传地点封面（`multipart/form-data`，JPG / PNG / WebP，≤ 5MB）。地点还没有图时任何人可补；已有图时只有创建者可换 |
| GET | `/uploads/:name` | 读取已上传的图片（无需登录，文件名为随机 UUID） |
| POST | `/places/:id/checkin` | 打卡（需在地点半径 + 50 米内；6 小时内重复只算一次），返回三类歌曲 |
| GET / POST | `/places/:id/songs` | 地点的歌 / 上传歌（`kind`: `vibe` `frequent` `live`） |
| PUT | `/place-songs/:id/vote` | `{value: 1 \| -1 \| 0}` 点赞 / 点踩 / 取消 |
| POST | `/place-songs/:id/listen` | 我也在听（每天每人一次） |
| DELETE | `/place-songs/:id` | 删除自己上传的 |
| GET / POST | `/places/:id/comments` | 评论列表（分页）/ 发评论 |
| PUT / DELETE | `/comments/:id/like` | 评论点赞 / 取消 |
| DELETE | `/comments/:id` | 删除自己的评论 |
| POST | `/admin/import` | 官方记录批量导入（`x-admin-key`） |

## 测试

```bash
cd server && npm test          # 58 个测试：权重 / 抽样 / 地理函数 + 全部 API 行为（含图片上传的格式 / 大小 / 权限）
cd server && npm run typecheck
cd app && npm run typecheck
```

### 端到端测试

用 Playwright 在手机尺寸的 Chromium 里对着真实后端和 web 版走一遍核心流程（模拟 GPS）：

```bash
# 终端 1：干净的数据库 + 示例数据 + 后端
cd server && rm -f e2e.db* && DB_PATH=e2e.db npm run seed -- --lat 31.24 --lng 121.49 && DB_PATH=e2e.db npm start

# 终端 2：导出 web 版并用任意静态服务器（需 SPA 回退到 index.html）托管在 :8081
cd app && EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo export --platform web
npx serve -s dist -l 8081

# 终端 3
cd e2e && npm install && npx playwright install chromium && npm run smoke
# 已有 Chromium 时：CHROMIUM_PATH=/path/to/chromium npm run smoke
```

## 地点图片

- 手机端选图后先缩放到 1280 宽并压成 JPEG（通常 200–400KB）再上传，服务端上限 5MB。
- 服务端**按文件头判断真实格式**（不信任扩展名 / `Content-Type`），只收 JPG / PNG / WebP；文件名用随机 UUID，读取接口用白名单正则校验文件名，杜绝路径穿越。
- 外链图片（`imageUrl`）只有官方导入接口能设置，普通用户的新建地点会忽略该字段。
- 权限：地点没有图 → 任何登录用户可补；已有图 → 仅创建者可换（换后自动回收旧文件），避免被别人顶掉。
- 示例数据的 4 张封面是 `server/seed-images/` 里的插画，`npm run seed` 会把它们复制到上传目录。

## 已知限制 / 下一步

- **身份是访客 token**：没有密码，退出或卸载后无法找回。上线前应接入手机号 / 第三方登录。
- **没有内容审核与限流**：上传、评论目前只有格式和长度校验。公开发布前需要举报、屏蔽、频率限制。
- **打卡防作弊较弱**：服务端只校验上报的坐标与地点的距离，无法识别伪造的 GPS。
- **图片存在本机磁盘**：多实例部署或容器重建会丢图，需换成对象存储（S3 / OSS）并走 CDN；也没有做内容审核（违规图片）。
- **没有地图视图**：地点以列表 + 距离展示。可以后续接入 `react-native-maps` / 高德 / Mapbox。
- **没有内置搜索与播放**：歌曲靠手动输入歌名歌手，播放靠用户贴的外链（网易云 / QQ 音乐 / Spotify…）。接入音乐平台的搜索 API 后可自动补全并内嵌试听。
- **原生端未在真机上验证**：开发环境里只验证了 TypeScript、`expo-doctor` 以及 web 版的完整流程；iOS / Android 真机的定位权限弹窗、深色状态栏等需要你实机过一遍。
- 推荐权重里的各个系数是经验值，请在有真实数据后调参。
