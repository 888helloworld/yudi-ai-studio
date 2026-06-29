# 御弟哥哥 AI 图文创作工作台

嘿，欢迎来到“御弟哥哥”——一个给内容创作者、电商卖家、设计团队和运营同学准备的小工具。

你可以把它理解成一个能帮你写文案、配图、改图的个人助手，顺便还带个后台管管积分和用量。项目目前最核心、最好玩的部分叫“画面工坊”，基本就是你上传参考图、写几句描述，然后让 AI 给你出图的页面。

整个系统是一个轻量的 Node.js 单体应用，数据库跑着 SQLite，前端就是原生三件套（HTML/CSS/JS），后端用 Express 搭起来。选型主打简单直接，适合一个人或小团队在本地、内网先跑起来，以后有需要再往复杂架构上走。

---

## 这玩意儿到底能干啥？

| 模块 | 页面/接口 | 说明 |
| --- | --- | --- |
| 首页 | `index.html` | 内容创作的入口，从这里出发 |
| 小红书工作台 | `xhs.html` | 小红书配图、标题、正文、标签一站搞定 |
| 画面工坊 | `image-studio.html` | **主角**：文生图、参考图改图、看图写 Prompt、生成记录 |
| 旧生图入口 | `xi-image.html` | 自动跳转到画面工坊，免得你迷路 |
| 看图写 Prompt | `reverse-prompt.html` | 上传一张图，让 AI 反推出提示词 |
| 个人中心 | `profile.html` | 查看积分、历史、卡密、订单、邀请码 |
| 管理后台 | `admin.html` | 管理员专用：管用户、充积分、看流水、发卡密 |
| 登录/注册 | `login.html` / `register.html` | 用 JWT 登录；本地或内网访问时可以不需要邀请码 |
| 帮助与协议 | `help.html`、`terms.html`、`privacy.html`、`content-policy.html` | 一些基础说明 |

如果你刚来，建议直奔**画面工坊**（`image-studio.html`），那是目前打磨最久、功能最集中的地方。

---

## 画面工坊：你的私人 AI 画室

画面工坊是整个项目目前最重要的页面。它专门负责和图片模型打交道，尤其是 `gpt-image-2` 这个能在文字描述和参考图之间切换的画图引擎。

### 它能做的事情

- **文生图**：写一段描述，AI 给你出图。
- **参考图改图**：上传最多 4 张参考图，告诉 AI“照着这个感觉，但改改光线/构图”。
- **多种上传方式**：点击上传、拖拽上传、甚至直接粘贴剪贴板里的图片。
- **批量生成**：你只需要填“要生成几张”，系统自动安排。
- **并发控制**：你还可以填“同时生成几张”，控制同一时间跑几个任务。
- **质量档位**：快速、标准、精细，分别对应上游的 `low`、`medium`、`high`。
- **生成记录**：每个任务都能查看进度、预览结果、单张下载、重新生成、复制提示词。
- **参考图复用**：可以把已生成的图直接拖回参考图区域，继续改。
- **历史编号**：列表中优先展示数据库历史 ID，比如 `#539`，而不是一串看不懂的时间戳。

### 关于图片尺寸，有个“小魔法”你得知道

上游 `gpt-image-2` 当前有个特点：你请求的尺寸和实际拿到的图片尺寸有时不完全相同。页面会按**你真正看到的图片尺寸**展示，但发给上游的请求仍然使用它目前接受的参数。

下面这张表记录了我们实测的结果（如果你发现变化，请以实际出图尺寸为准）：

| 页面选的比例 | 实际返回尺寸 | 请求上游的 `size` | 备注 |
| --- | --- | --- | --- |
| 1:1 方图 | `1254x1254` | `1024x1024` | 你请求 1024 方图，上游大概率回来 1254 方图 |
| 2:3 竖图 | `1024x1536` | `1024x1536` | 正常听话 |
| 3:2 横图 | `1536x1024` | `1536x1024` | 正常听话 |
| 16:9 横图 | `1672x941` | `2560x1440` | 你请求 2K 横图，上游给你 1672x941 |

至于 **4K**那个按钮，我们已经暂时去掉了。因为测试发现，不管请求 `3840x2160` 还是 `2560x1440`，上游都返回 `1672x941`，没必要单独留着它误导你。

### 尺寸不一致时系统怎么处理？

服务端保存上游返回的图片之后，会读取真实的 PNG 尺寸，并把真实宽高记在历史记录的 `output_dimensions` 字段里。

当前策略很简单：

- 上游返回尺寸和请求尺寸不一致？**不拦截，不退款，不丢图**。 原图照样存、照样给你。
- 服务端日志会悄悄记一笔，提醒你“真实尺寸和请求尺寸不一样”。
- 如果你非要让图片拉伸/裁切到请求尺寸，可以设置环境变量 `XI_XU_NORMALIZE_OUTPUT_SIZE=true`。**大多数情况不建议开**，因为它会改原图画布，可能不是你想要的。

---

## gpt-image-2 的价格怎么算的？

画面工坊页面里，“快速/标准/精细”后面显示的美元价格，是根据 new-api / 官方计算方式在前端实时估算的，目的是让你心里有个谱：上游大概要花多少钱。

质量档位和上游参数的对应关系：

| 页面文案 | API `quality` | 基准 grid (qualityBase) |
| --- | --- | --- |
| 快速 | `low` | 16 |
| 标准 | `medium` | 48 |
| 精细 | `high` | 96 |

计算公式大致是这个思路（主要是为了计算 tokens 数）：

```text
short = min(width, height)
long = max(width, height)
pixels = width * height
scaledShort = round(qualityBase * short / long)
grid = qualityBase * scaledShort
tokens = ceil(grid * (2000000 + pixels) / 4000000)
priceUsd = tokens * 30 / 1000000
```

用不着死记，看一眼下面的典型例子就行：

| 质量 | 尺寸 | tokens | 约 USD |
| --- | --- | ---: | ---: |
| 快速 | `1024x1024` | 196 | `$0.00588` |
| 标准 | `1024x1024` | 1756 | `$0.05268` |
| 精细 | `1024x1024` | 7024 | `$0.21072` |
| 快速 | `1024x1536` | 158 | `$0.00474` |
| 标准 | `1024x1536` | 1372 | `$0.04116` |
| 精细 | `1024x1536` | 5488 | `$0.16464` |
| 快速 | `1536x1024` | 158 | `$0.00474` |
| 标准 | `1536x1024` | 1372 | `$0.04116` |
| 精细 | `1536x1024` | 5488 | `$0.16464` |
| 快速 | `2560x1440` | 167 | `$0.00501` |
| 标准 | `2560x1440` | 1512 | `$0.04536` |
| 精细 | `2560x1440` | 6048 | `$0.18144` |

**重要提醒**：这只是在页面展示的**上游美元成本估算**。咱们自己系统扣的是**积分**，目前图片生成固定扣 `10 积分/张`（在 `server.js` 里写死的 `POINTS.image = 10`）。生成失败或者实际出图数量少于请求数量时，系统会按缺少的张数自动退积分，和美元成本没有直接关系。

---

## 积分规则

当前后端基础积分配置长这样，你可以根据需要在代码里调整：

| 行为 | 扣积分 |
| --- | ---: |
| 图片生成 | 10 / 张 |
| 文案生成 | 5 / 次 |
| 文案改写 | 3 / 次 |
| 图文一体 | 15 起，按图片张数叠加 |
| 看图写 Prompt | 5 / 次 |

积分相关的几个贴心设定：

- 新用户默认赠送积分，默认 1000 分（可通过环境变量 `NEW_USER_BONUS_POINTS` 修改）。
- 扣积分用的是 SQLite 的原子更新操作，保证在高并发时不会把余额扣成负数。
- 图片生成如果失败了，积分自动退。
- 批量生成时实际出图少于请求数量，按缺的图数退款。
- 服务重启后，所有还没完成的 `gpt-image-2` 队列任务会被标记为失败并退积分。
- 管理员可以在后台给用户充值、生成卡密、查看积分流水。

---

## 画面工坊的队列和并发控制

画面工坊有两层并发，你可以分别调整：

- **前端“同时生成几张”**：控制浏览器一次提交多少个任务，也就是同时发起几组生成请求。
- **服务端 `XI_XU_MAX_ACTIVE_JOBS`**：控制同一时刻真正跑多少个 `gpt-image-2` 上游任务。

环境变量示例：

```env
XI_XU_MAX_ACTIVE_JOBS=0
XI_XU_IMAGE_RATE_LIMIT_PER_MIN=30
```

- 当 `XI_XU_MAX_ACTIVE_JOBS=0`、`unlimited`、`infinite`、`none` 时，服务端不设任务并发上限。
- 如果你填其他数字，会被解析成至少为 1 的整数。
- `XI_XU_IMAGE_RATE_LIMIT_PER_MIN` 限制了图片相关接口每分钟请求数，默认 30。
- 实际生成速度还会受上游 API 限流、网络、服务器带宽、浏览器同时连接数等因素影响，并不是开得越大越快。

---

## API 概览

所有的用户侧生成接口都要求先登录，然后在请求头里带上 JWT：

```http
Authorization: Bearer <你的令牌>
```

### 账号相关

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/auth/register-config` | 查看当前是否需要邀请码才能注册 |
| `POST` | `/api/auth/register` | 注册 |
| `POST` | `/api/auth/login` | 登录 |
| `GET` | `/api/auth/me` | 获取当前用户信息 |

### 用户中心

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/user/points` | 查积分余额 |
| `GET` | `/api/user/points/logs` | 积分流水 |
| `GET` | `/api/user/history` | 我的生成历史 |
| `DELETE` | `/api/user/history/:id` | 删除某条历史 |
| `GET` | `/api/user/stats` | 我的统计 |
| `GET` | `/api/user/invites` | 我的邀请码列表 |
| `POST` | `/api/user/invites/generate` | 生成新邀请码 |
| `POST` | `/api/user/change-password` | 修改密码 |

### 画面工坊推荐使用的任务接口

推荐使用下面这套任务接口，因为它支持排队、轮询状态，而且服务重启后会帮你自动处理遗留任务。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/xi-image/jobs` | 获取当前用户的排队/运行中任务 |
| `GET` | `/api/xi-image/jobs/:id` | 查询单个任务状态 |
| `POST` | `/api/xi-image/jobs/generate` | 创建文生图任务 |
| `POST` | `/api/xi-image/jobs/edit` | 创建参考图改图任务 |

文生图示例：

```bash
curl -X POST http://localhost:3001/api/xi-image/jobs/generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a clean editorial product photo, soft directional light",
    "size": "1024x1536",
    "count": 1,
    "quality": "high"
  }'
```

参考图改图示例（图片文件用 multipart 上传）：

```bash
curl -X POST http://localhost:3001/api/xi-image/jobs/edit \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "prompt=keep the subject, improve lighting and composition" \
  -F "size=1024x1536" \
  -F "count=1" \
  -F "quality=high" \
  -F "image=@reference.png"
```

### 同时也保留的直接调用接口

如果你只想简单调用，不走任务队列，也可以：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/xi-image/generate` | 直接文生图 |
| `POST` | `/api/xi-image/edit` | 直接改图 |
| `POST` | `/api/xi-image/reverse-prompt` | 看图写 Prompt |

### 小红书和电商相关接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/generate` | 小红书图片生成 |
| `POST` | `/generate-copy` | DeepSeek 文案生成 |
| `POST` | `/rewrite` | 文案改写 |
| `POST` | `/generate-both` | 图文一体生成 |
| `POST` | `/api/amazon-image/generate` | 亚马逊主图批量生成 |

亚马逊主图示例：

```bash
curl -X POST http://localhost:3001/api/amazon-image/generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "prompt=304 stainless steel insulated cup, black, with lid, pure white background, professional studio photo" \
  -F "ratio=1:1" \
  -F "imageCount=4"
```

---

## 注册和邀请码

系统会根据访问 IP 自动判断是否需要邀请码：

- 本地或内网访问（`localhost`、`127.0.0.1`、`10.x.x.x`、`192.168.x.x`、`172.16-31.x.x`）默认**不需要**邀请码。
- 公网访问默认**需要**邀请码。

你也可以通过环境变量强制控制：

```env
# 不管什么环境，都免邀请码
LOCAL_REGISTER_WITHOUT_INVITE=true

# 不管什么环境，都必须邀请码
LOCAL_REGISTER_WITHOUT_INVITE=false
```

前端注册页面会先调 `/api/auth/register-config`，如果返回 `inviteRequired:false`，邀请码输入框会自动隐藏起来，省得用户疑惑。

---

## 环境变量

复制项目里的 `.env.example` 为 `.env`，然后填上你自己的配置。**特别注意：不要把真实密钥提交到 Git。**

```env
PORT=3001
HOST=0.0.0.0
ALLOWED_ORIGIN=http://localhost:3001

ARK_API_KEY=your_ark_api_key_here

DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_TEXT_MODEL=deepseek-v4-pro

XI_XU_API_BASE_URL=https://your-image-api.example
XI_XU_API_KEY=your_xi_xu_api_key_here
XI_XU_IMAGE_MODEL=gpt-image-2
XI_XU_VISION_MODEL=gpt-5.5
XI_XU_GENERATE_TIMEOUT_MS=1800000
XI_XU_GENERATE_RETRIES=1
XI_XU_EDIT_TIMEOUT_MS=180000
XI_XU_EDIT_RETRIES=1
XI_XU_EDIT_FORCE_FALLBACK=false
XI_XU_EDIT_CIRCUIT_BREAKER_MS=120000
XI_XU_MAX_ACTIVE_JOBS=0
XI_XU_IMAGE_RATE_LIMIT_PER_MIN=30
XI_XU_NORMALIZE_OUTPUT_SIZE=false

ARK_FALLBACK_ENABLED=true
MAX_UPLOAD_IMAGE_MB=10

JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d

ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace_with_a_strong_password

NEW_USER_BONUS_POINTS=1000
USER_INVITE_POINTS=0
LOCAL_REGISTER_WITHOUT_INVITE=

ENABLE_MOCK_PAYMENT=false
MOCK_PAYMENT_TOKEN=replace_with_a_long_random_token
PAYMENT_PROVIDER=mock
PUBLIC_BASE_URL=https://your-domain.example
```

如果你用的是官方 OpenAI 图片接口，也可以额外配置这些变量：

```env
OPENAI_IMAGE_API_BASE_URL=https://api.openai.com
OPENAI_IMAGE_API_KEY=your_openai_api_key
```

只要配置了 `OPENAI_IMAGE_API_KEY` 或 `OPENAI_IMAGE_API_BASE_URL`，图片请求会优先走这套 OpenAI 配置；否则才会使用 `XI_XU_API_BASE_URL` 和 `XI_XU_API_KEY`。

---

## 本地跑起来

先把依赖装好：

```bash
npm install
```

然后启动服务：

```bash
npm start
```

默认访问地址：

```text
http://localhost:3001
```

语法检查：

```bash
npm run check
```

Windows 下如果想让服务在后台保活，可以用我们准备好的脚本：

```powershell
.\deploy\ensure-local-service.ps1
```

---

## 管理后台

第一次启动时，如果数据库里还没有管理员，系统会自动用 `.env` 里的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 创建管理员账号。

登录管理后台（`admin.html`）后，管理员可以：

- 查看用户列表，删除用户，重置用户密码
- 给用户充值积分
- 查看和删除生成历史
- 查看积分流水
- 生成卡密、查看卡密统计
- 查看支付订单，手动确认到账或关闭订单
- 检查系统配置
- 对 `gpt-image-2` 上游做 ping 测试

**生产环境一定要把管理员密码改成强密码，不要用默认值上线。**

---

## 支付那点事儿

目前支付流程还是“模拟订单 + 人工确认”模式，主要方便内部测试：

- `/api/payment/create` 创建订单。
- 管理员在后台手动把订单标记为已支付。
- 真实的支付宝/微信回调接口已经留好了位置，但在完成验签逻辑之前不会自动入账。

如果你准备进入正式收费阶段，务必完成下面这些事：

- 对接支付宝/微信真实下单接口
- 实现回调验签（RSA 公钥、证书校验等）
- 幂等处理，防止重复到账
- 订单金额二次校验
- 回调 IP/证书/平台公钥校验
- 准备好财务对账流程

---

## 数据库和备份

默认数据库文件就是项目根目录下的：

```text
data.db
```

里面核心的表有这些：

| 表 | 说明 |
| --- | --- |
| `users` | 用户信息，密码存的是哈希，还有积分和角色 |
| `point_logs` | 积分流水 |
| `history` | 所有生成历史 |
| `cdkeys` | 卡密和邀请码 |
| `payment_orders` | 支付订单 |

以下文件和目录属于运行时数据，**不要提交到 Git**：

- `.env`
- `data.db`
- `uploads/`
- `logs/`
- `node_modules/`
- `history.json`

生产环境建议定期备份这几个关键东西：

- `data.db`
- `uploads/`
- 云端 `.env`（安全存放，不要公开）

---

## 上传和图片保存

- 上传文件默认限制最大 `10MB`（`MAX_UPLOAD_IMAGE_MB=10`）。
- 改图时上传的参考图会在服务端先处理并限制大小。
- 支持常见图片 MIME 并校验文件头，防止伪装文件。
- 生成的图片会先下载到本地的 `uploads/` 目录，然后以本地 URL 返回。
- 现在 `/uploads` 的设置是“知道链接就能访问”，适合内部工具。如果你处理的是客户隐私图、人脸图、未公开商品图，强烈建议升级为鉴权图片代理或签名 URL。

---

## 安全相关的唠叨

我们已经做了这些安全措施：

- 生产环境如果没设置 `JWT_SECRET`，服务会拒绝启动。
- `ENABLE_MOCK_PAYMENT` 默认关闭；模拟支付回调也必须配置 `MOCK_PAYMENT_TOKEN`。
- 图片接口、注册接口都有限流。
- 用户列表和历史查询都有分页限制。
- 上传文件有大小限制、MIME 白名单和文件头检查。
- `/uploads` 添加了 `Cache-Control: private`、`X-Content-Type-Options: nosniff`、`X-Robots-Tag: noindex`。
- 响应头关闭了 `X-Powered-By`。
- 上传依赖库使用了 `multer` 2.x。

你仍然需要注意这几点：

- JWT 目前存在浏览器 `localStorage`，万一以后出现 XSS 漏洞，令牌可能被偷走。生产环境时，建议升级为 HttpOnly Cookie，并收紧 CSP 策略，给 `/uploads` 加上鉴权。
- 支付正式上线前，必须完成真实回调验签，否则一切都只是模拟。
- **任何时候都不要把真实 API Key、服务器地址、SSH 信息、管理员密码、支付密钥提交到仓库或公开分享。**

---

## 部署

详细的部署说明看这里：[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

目前的部署规则很简单：你的本地代码是唯一真源，云端运行时数据（`.env`、`data.db`、`uploads/`）要以云端为准。正常部署只会更新代码，不会覆盖云端的用户、积分、历史和图片。

执行部署命令：

```powershell
.\deploy\deploy.ps1
```

只有第一次安装或者明确要恢复数据时，才加上 `-IncludeRuntimeData` 参数：

```powershell
.\deploy\deploy.ps1 -IncludeRuntimeData
```

---

## 常用命令速查

```bash
npm install
npm start
npm run check
```

```powershell
.\deploy\ensure-local-service.ps1
.\deploy\deploy.ps1
```

```bash
git status --short --branch
git log -1 --oneline
git push
```

---

## 更多文档

- [部署说明](docs/DEPLOYMENT.md)
- [产品框架](docs/PRODUCT_FRAMEWORK.md)
- [指标和埋点](docs/METRICS_AND_EVENTS.md)
- [迭代路线](docs/ROADMAP.md)
- [发布验收清单](docs/RELEASE_CHECKLIST.md)

---

## 当前已知的“小脾气”和限制

- `gpt-image-2` 上游的尺寸会发生变化，上面那张尺寸表是基于当前测试和页面适配总结的，将来可能会有出入，请以实际出图为准。
- 4K 按钮已经拿掉了，因为目前上游不管你怎么请求大横图，返回的实际尺寸都和 2K 横图一样，没必要单独保留。
- 积分扣费（每张 10 积分）和页面展示的美元成本是两套独立的逻辑：前端算的是上游成本估算，后端按积分扣费，互不干扰。
- 支付目前还是模拟/人工确认，不是生产级自动收款。
- `/uploads` 还不是严格私有资源，暴露给知道链接的人。
- 项目是轻量单体结构，特别适合低并发场景。如果要上高并发商用，后面需要拆分任务队列、引入对象存储、升级支付服务和日志监控等。
- 服务重启会清理未完成的任务并退积分，如果你在运行大量长时间任务，注意安排好重启时机。
