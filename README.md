# 互相恶心大作战 🤢

一个给两个好朋友在线互坑的卡通搞怪小游戏。一人开房，另一人用 4 位房间码或分享链接加入；互丢臭袜子、烂番茄、放屁云，擦掉对方糊到你屏幕上的垃圾，再顺便测测你们到底还有没有默契。

> 100% 卡通垃圾，没有真实生化武器；所有画面和音效均由 CSS / SVG / Web Audio 程序化生成，不含第三方素材。

## 运行

要求：Node.js 20+

```bash
npm install --registry=https://registry.npmmirror.com
npm start
```

默认监听 `0.0.0.0:43124`。打开：

- 本机：<http://localhost:43124>
- 同一局域网的另一台设备：`http://<你的局域网IP>:43124`
- 分享链接：大厅里点「复制邀请链接」，格式为 `http://<IP>:43124/?room=房间码`

端口可通过环境变量修改：

```bash
PORT=8080 npm start
```

## 玩法

1. 输入花名创建房间，把房间码或链接发给朋友。
2. 准备室任一人选择玩法，房主按下「开战！」：
   - **恶心大作战**：60 秒互丢垃圾。点底部道具糊对方屏幕，自己被糊就疯狂滑动擦掉。双方几乎同时丢出同种道具会触发「居然有默契！」加分。
   - **默契大考验**：双方同时看到同一道搞怪题，3–4 个选项、10 秒倒计时。选一样「默契 +1」；不一样就「没有默契了！」，两边屏幕一起被垃圾淹没。
   - **混合双打**：投掷 → 默契问答 → 终极投掷。
3. 结算页包含糊脸分、糊屏率、默契题数、同步投掷次数、默契指数和搞笑称号；双方都按「再来一局」即可重赛。

特殊道具：🧦 臭袜子会冒臭雾、💨 放屁云有放屁音效和震屏、🪳 蟑螂贴纸会爬、🌀 颠倒泡泡会把屏幕倒过来 2 秒、🫧 鼻涕泡和 🟢 史莱姆要多擦几下。

玩法说明在大厅/首页右上角的 `?` 按钮里，首次访问也会自动弹出。

## 实时连接

- 优先使用同源 WebSocket：`/ws`
- 3 秒内连不上或 WebSocket 断开时自动降级为 HTTP 长轮询：`GET /api/poll?token=...&since=...`，操作通过 `POST /api/action` 提交。微信内置浏览器、部分移动网络拦截 `IP:端口` 的 WebSocket 时仍然能玩。
- 房间状态保存在服务端内存中；玩家掉线时比赛自动暂停，重连（包括刷新页面后自动恢复本地会话）后继续。服务重启后房间会丢失。

## 测试

```bash
npm test
```

`test/e2e.js` 会自行在随机端口启动临时服务器（使用更短的回合时间），然后：

- 一个 **WebSocket** 客户端 + 一个 **HTTP 长轮询** 客户端创建/加入房间；
- 完整跑完「恶心大作战」「默契大考验」「混合双打」三种模式；
- 校验同步投掷、擦拭、答题（同选/分歧）、双方分数、结算称号、默契指数和重赛；
- 测试结束自动关闭临时服务器。

> 测试中的回合时长通过环境变量缩短（见 `test/e2e.js`）；正常 `npm start` 默认 60 秒一回合。

## 目录

```text
server.js               HTTP 静态服务 / API / WebSocket 入口
src/config.js           端口与各时长配置
src/game.js             房间、状态机、同步逻辑、计分与结算
src/questions.js        28 道默契题（服务端）
shared/catalog.js       服务端与浏览器共享的道具目录
public/index.html       页面结构
public/styles.css       视觉与响应式布局
public/app.js           浏览器 UI、绘制、擦拭、音画效果
public/realtime.js      WebSocket 优先 + 长轮询降级
public/audio.js         Web Audio 程序化音效
test/e2e.js             双客户端端到端测试
```

## 可调环境变量

`PORT`（默认 43124）、`ROUND_SECONDS`（60）、`QUIZ_SECONDS`（10）、`QUIZ_QUESTIONS`（5）、`MIXED_QUIZ_QUESTIONS`（3）、`STAGE_INTRO_MS`、`SYNC_WINDOW_MS`、`THROW_COOLDOWN_MS`、`OFFLINE_THRESHOLD_MS` 等，详见 `src/config.js`。修改回合时长后用 `npm start` 即生效。
