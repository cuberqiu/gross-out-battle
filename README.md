# 互相恶心大作战

两个朋友在各自的浏览器里互相扔卡通臭东西。臭袜子、烂番茄、鼻涕泡、史莱姆、放屁云、蟑螂贴纸、芥末和隔夜外卖会实时糊到对方屏幕上，对方得一边擦一边扔回来。还可以玩「默契大考验」：同一道傻题，选同一个就默契 +1，选不一样就一起被糊，并迎来那句「没有默契了！」。

画面和音效都是程序画出来、算出来的（SVG 和 Web Audio），没有外部图片素材。房间码只在这一台服务器的内存里，适合朋友局，不适合拆成多台同时开。

## 玩法

1. 一个人起外号，选模式，创建房间，把 4 位房间码、链接或二维码发给朋友。
2. 朋友打开链接，或在首页输入房间码加入。同一台电脑开两个窗口也能玩。
3. 房主点「开臭」。

三种模式：

- **恶心大作战**：大约 60 秒。点道具，再点屏幕，扔到对方屏幕的同一位置。按住摩擦，擦掉糊在你这边的。番茄会晃屏，芥末让屏幕倒转两秒，放屁云有声音，蟑螂贴纸会爬。擦得越快，对方的臭气分掉得越多。
- **默契大考验**：8 道题，两边同时看到，各有倒计时。选同一个庆祝；选不一样（或有人发呆）就播放丧气号，双方屏幕各糊一脸。
- **混合加倍**：30 秒对扔，然后一题，再来一轮，最后一起结算。

如果两个人几乎同时扔出同一种东西，会弹出「居然有默契！」。结算给出臭气值、默契指数，以及一个很没面子的称号。输家的第一局称号是「今日最臭王」。默契指数：

| 指数 | 判词 |
| --- | --- |
| 0–30% | 已经没有默契了 |
| 31–60% | 勉强算认识 |
| 61–89% | 臭味相投 |
| 90%+ | 心灵相通的恶心搭档 |

有人掉线时对局会暂停大约 20 秒。回来就继续；超时就判「临阵脱逃」。结算页可以再来一局。

## 本地运行

需要 Node.js 20 或更新。

```bash
npm install
npm run dev
```

浏览器打开 [http://127.0.0.1:43123](http://127.0.0.1:43123)。开发时网页在 43123，对战服务器在 43124，Vite 会把 `/ws`、`/rt` 和 `/health` 代理过去。

生产模式是一个进程同时提供网页和 WebSocket：

```bash
npm run build
NODE_ENV=production PORT=43123 npm start
```

有的手机网络和微信内置浏览器会把 WebSocket 升级丢掉。页面会先连 `/ws`；大约 3 秒还没打开，或者连续两次在打开前就断开，这一局就改走同一端口的 HTTP（`POST /rt/open`、`GET /rt/poll` 长轮询约 20 秒、`POST /rt/send`），不再换回 WebSocket。扔东西会多大约一两百毫秒。这些响应不缓存。测试时打开 `?transport=http` 可以强制走 HTTP。

## 环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `PORT` | 生产 43123 | 生产端口。开发时游戏服固定 43124 |
| `ROUND_MS` | 60000 | 恶心大作战时长 |
| `COUNTDOWN_MS` | 3000 | 开局倒计时 |
| `SYNC_QUESTION_MS` | 12000 | 每道默契题的作答时间 |
| `SYNC_RESULT_MS` | 4000 | 对错揭晓停顿 |
| `SYNC_QUESTIONS` | 8 | 默契模式题数 |
| `MIXED_BATTLE_MS` | 30000 | 混合模式每段对扔 |
| `MIXED_CYCLES` | 2 | 混合模式「对扔 + 一题」的轮数 |
| `RECONNECT_GRACE_MS` | 20000 | 掉线后等多久 |

## 部署

房间状态在内存里。只跑一个进程。反向代理要把 WebSocket 升级转过去；连不上 WebSocket 的客户端会改走 `/rt`，那是普通 HTTP，不要缓存。`/rt/poll` 会挂起大约 20 秒，代理的读超时要大于这个时间。

Node：

```bash
npm ci
npm run build
NODE_ENV=production PORT=43123 npm start
```

健康检查：`GET /health`。

Docker：

```bash
docker build -t gross-out .
docker run -p 43123:43123 gross-out
```

Nginx 示例：

```nginx
location /ws {
  proxy_pass http://127.0.0.1:43123;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
location / {
  proxy_pass http://127.0.0.1:43123;
  proxy_set_header Host $host;
}
```

## 测试

自动化测试用 Playwright 开两个浏览器上下文，走完创建房间、互扔、擦除、特殊效果、默契对错、混合模式、掉线和再来一局。测试里的回合被环境变量缩短了，正式游戏仍是上面的默认时长。

```bash
npx playwright install chromium
npm test
```

截图会写到 `screenshots/`。

---

# Gross-Out Duel

Two friends throw cartoon-gross stickers at each other's screens in the browser: stinky socks, rotten tomatoes, snot bubbles, slime, fart clouds, cockroach stickers, wasabi, and leftover takeout. Wipe with a drag. There is also a sync quiz. Pick the same silly answer and you score a point of telepathy. Pick differently and both screens get splattered while a sad trombone plays the running joke 「没有默契了」 ("we've lost our telepathic sync").

Art is inline SVG. Sound is Web Audio. Nothing is loaded from a copyrighted asset pack. Rooms live in memory on one process.

## How to play

1. Pick a nickname and a mode, create a room, and send the 4-character code, link, or QR code.
2. Your friend opens the link, or types the code on the home screen. Two windows on one computer also work.
3. The host presses 开臭.

Modes:

- **Gross battle** (~60 seconds). Select an item, click or tap the screen, and it lands on the same relative spot on the other screen. Rub to wipe. Tomatoes shake the screen, wasabi flips it for two seconds, fart clouds make a noise, cockroach stickers crawl. Wiping lowers the thrower's score.
- **Sync quiz** (8 questions). Both players see the same prompt and a countdown. A match celebrates. A mismatch, or a timeout, punishes both screens.
- **Mixed**. A 30-second throw segment, one question, then another round of each, then the result.

Throwing the same item within a second of each other pops 「居然有默契！」. The result shows gross points, a sync percentage, and a rude title. The first battle's loser is stamped 今日最臭王 ("stinkiest of the day"). Sync bands: 0–30% already out of sync, 31–60% barely know each other, 61–89% kindred stink, 90%+ nasty soulmates.

A disconnect pauses the round for about 20 seconds. Rejoin to resume. Otherwise the missing friend forfeits. Either player can ask for a rematch from the result screen.

## Run locally

Node.js 20+.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123). In development the site is on 43123 and the game server is on 43124. Vite proxies `/ws`, `/rt`, and `/health`.

Production serves the site and the WebSocket from one process:

```bash
npm run build
NODE_ENV=production PORT=43123 npm start
```

Some mobile networks and WeChat's in-app browser drop the WebSocket upgrade. The page tries `/ws` first. If it is not open within about 3 seconds, or it fails twice before ever opening, that session switches to HTTP on the same port and stays there: `POST /rt/open`, a long poll on `GET /rt/poll` (about 20 seconds), and `POST /rt/send`. Throws pick up a few hundred milliseconds. Those responses are not cached. Add `?transport=http` to force the fallback.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 43123 in production | Listen port. The dev game server stays on 43124 |
| `ROUND_MS` | 60000 | Gross-battle length |
| `COUNTDOWN_MS` | 3000 | Countdown |
| `SYNC_QUESTION_MS` | 12000 | Time to answer one quiz question |
| `SYNC_RESULT_MS` | 4000 | How long the match or mismatch stays up |
| `SYNC_QUESTIONS` | 8 | Questions in sync mode |
| `MIXED_BATTLE_MS` | 30000 | Each throw segment in mixed mode |
| `MIXED_CYCLES` | 2 | Throw-plus-question cycles in mixed mode |
| `RECONNECT_GRACE_MS` | 20000 | How long to wait for a dropped friend |

## Deploy

Keep a single instance. The process stores rooms in memory. The reverse proxy must forward the WebSocket upgrade. Clients that cannot open a socket use `/rt` instead, which is plain HTTP and must not be cached. `/rt/poll` stays open for about 20 seconds, so the proxy read timeout has to be longer than that.

```bash
npm ci
npm run build
NODE_ENV=production PORT=43123 npm start
```

`GET /health` is the health check.

```bash
docker build -t gross-out .
docker run -p 43123:43123 gross-out
```

Nginx:

```nginx
location /ws {
  proxy_pass http://127.0.0.1:43123;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
location / {
  proxy_pass http://127.0.0.1:43123;
  proxy_set_header Host $host;
}
```

## Tests

Playwright opens two browser contexts and plays a shortened round: create, join, throws, wipes, special effects, the sync quiz, mixed mode, disconnect, and rematch. Production defaults stay at the full durations above. The test server only shortens its own timers.

```bash
npx playwright install chromium
npm test
```

Screenshots land in `screenshots/`.

## 部署

游戏部署在 <http://101.96.221.193:43123>，由 systemd --user 服务 `gross-out-battle` 运行。
