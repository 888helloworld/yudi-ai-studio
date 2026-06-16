# 御弟哥哥 AI 图文创作工作台

御弟哥哥是一个面向内容创作者、电商卖家、设计团队和运营人员的 AI 图文工作台。项目目前以“小红书内容生产 + 通用 AI 生图 + 参考图改图 + 看图写 Prompt + 积分运营后台”为核心，适合个人本地部署、团队内部使用，也可以继续扩展成 SaaS。

当前项目是轻量 Node.js 单体应用：

- 前端：原生 HTML、CSS、JavaScript
- 后端：Express
- 数据库：SQLite / better-sqlite3
- 鉴权：JWT
- 上传：Multer 2.x
- 文案模型：DeepSeek
- 图片模型：火山引擎图片接口、OpenAI-compatible `gpt-image-2`
- 运行方式：Node.js / PM2 / nginx

## 当前重点

当前最重要的页面是 `image-studio.html`，也就是“画面工坊”。它负责：

- `gpt-image-2` 文生图
- 上传 1-4 张参考图改图
- 看图写 Prompt
- 批量生成和并发控制
- 生成记录、预览、下载、重新生成
- 记录真实上游返回图片尺寸，尺寸不一致时仍保留原图返回

## 功能总览

| 模块 | 页面/接口 | 说明 |
| --- | --- | --- |
| 首页 | `index.html` | 内容创作入口 |
| 小红书工作台 | `xhs.html` | 小红书配图、标题、正文、标签 |
| 画面工坊 | `image-studio.html` | `gpt-image-2` 生图、改图、看图写 Prompt、生成记录 |
| 旧生图入口 | `xi-image.html` | 自动跳转到画面工坊 |
| 看图写 Prompt | `reverse-prompt.html` | 独立反推提示词页面 |
| 个人中心 | `profile.html` | 积分、历史、卡密、订单、邀请码 |
| 管理后台 | `admin.html` | 用户、历史、积分、卡密、订单和系统状态 |
| 登录/注册 | `login.html` / `register.html` | JWT 登录，本地/内网可免邀请码注册 |
| 帮助/协议 | `help.html`、`terms.html`、`privacy.html`、`content-policy.html` | 基础说明页 |

## 画面工坊

画面工坊是当前版本的核心生产页面。

### 支持能力

- 文生图：输入图片描述后生成图片。
- 参考图改图：最多上传 4 张参考图。
- 多种上传方式：点击上传、拖拽上传、粘贴图片。
- 批量生成：用户只需要填写“要生成几张”。
- 并发控制：用户可填写“同时生成几张”。
- 质量档位：快速、标准、精细，分别映射 `low`、`medium`、`high`。
- 图片记录：查看进度、结果预览、单张下载、重新生成、复制提示词。
- 参考图复用：可以把已生成图片重新放回参考图继续改图。
- 历史编号：优先展示数据库历史 ID，例如 `#539`，避免展示内部任务时间戳。

### 当前尺寸映射

上游 `gpt-image-2` 当前存在“请求尺寸”和“实际出图尺寸”不完全一致的情况。页面按用户能看到的真实出图尺寸展示，但请求仍使用上游当前接受的尺寸参数。

| 页面显示 | 实际展示尺寸 | 请求给上游的 `size` | 备注 |
| --- | --- | --- | --- |
| 1:1 方图 | `1254x1254` | `1024x1024` | 当前上游请求 1024 方图会返回 1254 方图 |
| 2:3 竖图 | `1024x1536` | `1024x1536` | 正常返回 |
| 3:2 横图 | `1536x1024` | `1536x1024` | 正常返回 |
| 16:9 横图 | `1672x941` | `2560x1440` | 当前上游请求 2K 横图会返回 1672x941 |

4K 入口已从页面去掉。测试中 `3840x2160` 和 `2560x1440` 都返回 `1672x941`，所以目前不再单独提供 4K 按钮。

### 尺寸不匹配处理

服务端保存上游返回图片后会读取 PNG 尺寸，并把真实尺寸写入历史记录的 `output_dimensions`。

当前默认策略是：

- 上游返回尺寸和请求尺寸不一致时，不拦截、不退款、不丢图。
- 继续保存原图并回传给前端。
- 服务端日志会输出尺寸不匹配警告。
- 如果显式设置 `XI_XU_NORMALIZE_OUTPUT_SIZE=true`，服务端才会把图片规整到请求尺寸；默认不建议开启，因为会改变原图画布。

## gpt-image-2 价格显示

画面工坊里的快速、标准、精细价格按照 new-api / 官方计算方式在前端实时计算，用于给用户看到大概的上游 USD 成本。

质量映射：

| 页面文案 | API `quality` | base grid |
| --- | --- | --- |
| 快速 | `low` | 16 |
| 标准 | `medium` | 48 |
| 精细 | `high` | 96 |

计算公式：

```text
short = min(width, height)
long = max(width, height)
pixels = width * height
scaledShort = round(qualityBase * short / long)
grid = qualityBase * scaledShort
tokens = ceil(grid * (2000000 + pixels) / 4000000)
priceUsd = tokens * 30 / 1000000
```

典型价格：

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

注意：这是上游美元成本估算。项目自己的积分扣费目前仍按平台规则扣积分，`POINTS.image = 10`，也就是每张图片扣 10 积分；失败或少出图会按实际成功张数退款。

## 积分规则

当前后端基础积分配置在 `server.js`：

| 行为 | 积分 |
| --- | ---: |
| 图片生成 | 10 / 张 |
| 文案生成 | 5 / 次 |
| 文案改写 | 3 / 次 |
| 图文一体 | 15 起，按图片张数叠加 |
| 看图写 Prompt | 5 / 次 |

积分相关特性：

- 新用户默认赠送积分，默认值来自 `NEW_USER_BONUS_POINTS`，未配置时为 1000。
- 扣费使用 SQLite 原子更新，避免并发时余额被扣成负数。
- 图片生成失败自动退款。
- 少出图时按缺少的张数退款。
- 服务重启后，未完成的 `gpt-image-2` 队列任务会标记失败并退款。
- 管理后台可给用户充值、生成卡密、查看积分流水。

## gpt-image-2 队列和并发

画面工坊有两层并发：

- 前端“同时生成几张”：控制浏览器侧一次提交多少个任务。
- 服务端 `XI_XU_MAX_ACTIVE_JOBS`：控制真正同时跑多少个 `gpt-image-2` 上游任务。

配置说明：

```env
XI_XU_MAX_ACTIVE_JOBS=0
XI_XU_IMAGE_RATE_LIMIT_PER_MIN=30
```

- `XI_XU_MAX_ACTIVE_JOBS=0`、`unlimited`、`infinite`、`none` 都表示服务端不设任务并发上限。
- 其他数字会被解析为至少 1 的整数。
- `XI_XU_IMAGE_RATE_LIMIT_PER_MIN` 限制图片相关接口每分钟请求数，默认 30。
- 实际速度还会受到上游 API 限流、网络、服务器带宽、浏览器连接数影响。

## API 概览

所有用户侧生成接口都需要登录后携带 JWT：

```http
Authorization: Bearer <token>
```

### 账号

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/auth/register-config` | 返回当前是否需要邀请码 |
| `POST` | `/api/auth/register` | 注册 |
| `POST` | `/api/auth/login` | 登录 |
| `GET` | `/api/auth/me` | 当前用户 |

### 用户中心

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/user/points` | 积分余额 |
| `GET` | `/api/user/points/logs` | 积分流水 |
| `GET` | `/api/user/history` | 我的生成历史 |
| `DELETE` | `/api/user/history/:id` | 删除我的某条历史 |
| `GET` | `/api/user/stats` | 我的统计 |
| `GET` | `/api/user/invites` | 我的邀请码 |
| `POST` | `/api/user/invites/generate` | 生成邀请码 |
| `POST` | `/api/user/change-password` | 修改密码 |

### 画面工坊任务接口

推荐使用任务接口，因为它支持排队、轮询和重启遗留任务处理。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/xi-image/jobs` | 获取当前用户排队/运行中的任务 |
| `GET` | `/api/xi-image/jobs/:id` | 获取单个任务状态 |
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

参考图改图示例：

```bash
curl -X POST http://localhost:3001/api/xi-image/jobs/edit \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "prompt=keep the subject, improve lighting and composition" \
  -F "size=1024x1536" \
  -F "count=1" \
  -F "quality=high" \
  -F "image=@reference.png"
```

### 兼容直接接口

项目仍保留直接调用接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/xi-image/generate` | 直接 `gpt-image-2` 文生图 |
| `POST` | `/api/xi-image/edit` | 直接 `gpt-image-2` 改图 |
| `POST` | `/api/xi-image/reverse-prompt` | 看图写 Prompt |

### 小红书和电商接口

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

## 注册和邀请码

注册接口会根据访问环境决定是否需要邀请码：

- 本地或内网访问默认免邀请码，例如 `localhost`、`127.0.0.1`、`10.x.x.x`、`192.168.x.x`、`172.16-31.x.x`。
- 公网访问默认需要邀请码。
- 可用 `LOCAL_REGISTER_WITHOUT_INVITE` 强制控制。

配置示例：

```env
# 强制免邀请码
LOCAL_REGISTER_WITHOUT_INVITE=true

# 强制需要邀请码
LOCAL_REGISTER_WITHOUT_INVITE=false
```

前端注册页会调用 `/api/auth/register-config`，如果返回 `inviteRequired:false`，邀请码输入框会自动隐藏。

## 环境变量

复制 `.env.example` 为 `.env` 后配置。不要把真实密钥提交到 GitHub。

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

如果你使用官方 OpenAI 图片接口，也可以配置：

```env
OPENAI_IMAGE_API_BASE_URL=https://api.openai.com
OPENAI_IMAGE_API_KEY=your_openai_api_key
```

如果配置了 `OPENAI_IMAGE_API_KEY` 或 `OPENAI_IMAGE_API_BASE_URL`，图片请求会优先走这组配置；否则走 `XI_XU_API_BASE_URL` 和 `XI_XU_API_KEY`。

## 本地运行

安装依赖：

```bash
npm install
```

启动服务：

```bash
npm start
```

默认访问：

```text
http://localhost:3001
```

语法检查：

```bash
npm run check
```

Windows 本地守护脚本：

```powershell
.\deploy\ensure-local-service.ps1
```

## 管理后台

首次启动时，如果数据库里没有管理员，会使用 `.env` 中的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 创建管理员账号。

管理员可在 `admin.html` 中处理：

- 用户列表
- 删除用户
- 重置用户密码
- 用户积分充值
- 历史记录查询和删除
- 积分流水
- 卡密生成和统计
- 支付订单查看、确认到账、关闭订单
- 系统配置检查
- gpt-image-2 上游 ping

生产环境必须设置强管理员密码。不要使用默认密码上线。

## 支付状态

当前支付仍是模拟订单/人工确认流程，适合内部测试：

- `/api/payment/create` 创建订单。
- 管理后台可把订单标记为已支付。
- 真实支付宝/微信回调目前是占位保护逻辑，未完成验签前不会自动入账。

生产环境正式收费前必须完成：

- 支付宝/微信真实下单
- 平台回调验签
- 幂等处理
- 订单金额校验
- 回调 IP/证书/平台公钥校验
- 财务对账

## 数据库

默认数据库文件：

```text
data.db
```

核心表：

| 表 | 说明 |
| --- | --- |
| `users` | 用户、密码哈希、积分、角色 |
| `point_logs` | 积分流水 |
| `history` | 生成历史 |
| `cdkeys` | 卡密和邀请码 |
| `payment_orders` | 支付订单 |

这些文件和目录属于运行数据，不应该提交到 Git：

- `.env`
- `data.db`
- `uploads/`
- `logs/`
- `node_modules/`
- `history.json`

生产环境建议定期备份：

- `data.db`
- `uploads/`
- 云端 `.env`

## 上传和图片保存

- 上传文件默认限制为 `MAX_UPLOAD_IMAGE_MB=10`。
- 改图原图会在服务端处理并限制大小。
- 支持常见图片 MIME 和文件头校验。
- 生成图片会下载到本地 `uploads/` 后再返回本地 URL。
- `/uploads` 当前是“知道链接即可访问”，适合内部工具；如果用于客户隐私图、人脸图、未公开商品图，建议升级成鉴权图片代理或签名 URL。

## 安全说明

当前已做的安全措施：

- 生产环境没有 `JWT_SECRET` 会拒绝启动。
- `ENABLE_MOCK_PAYMENT` 默认关闭。
- 模拟支付回调开启时必须配置 `MOCK_PAYMENT_TOKEN`。
- 图片接口有限流。
- 注册接口有限流。
- 用户分页和后台分页有限制。
- 上传有大小限制、MIME 白名单和文件头校验。
- `/uploads` 添加了 `Cache-Control: private`、`X-Content-Type-Options: nosniff`、`X-Robots-Tag: noindex`。
- 关闭 `X-Powered-By`。
- 依赖使用 `multer` 2.x。

仍需注意：

- JWT 当前保存在浏览器 `localStorage`，如果未来出现 XSS，token 有泄露风险。
- 生产环境建议升级 HttpOnly Cookie、收紧 CSP、给 `/uploads` 加鉴权。
- 支付正式上线前必须完成真实验签。
- 不要提交任何真实 API Key、服务器地址、SSH 信息、管理员密码、支付密钥。

## 部署

部署说明见：

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

当前部署规则：

- 本地代码是代码源。
- 云端运行数据是云端源：`.env`、`data.db`、`uploads/`。
- 正常部署只更新代码，不覆盖云端用户、积分、历史和图片。

执行部署：

```powershell
.\deploy\deploy.ps1
```

只有首次安装或明确恢复数据时，才使用：

```powershell
.\deploy\deploy.ps1 -IncludeRuntimeData
```

## 常用命令

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

## 项目文档

- [部署说明](docs/DEPLOYMENT.md)
- [产品框架](docs/PRODUCT_FRAMEWORK.md)
- [指标和埋点](docs/METRICS_AND_EVENTS.md)
- [迭代路线](docs/ROADMAP.md)
- [发布验收清单](docs/RELEASE_CHECKLIST.md)

## 当前已知限制

- `gpt-image-2` 上游尺寸会变化，README 中尺寸表反映的是当前测试和页面适配结果。
- 4K 已暂时去掉，因为当前上游和 2K 横图返回同一实际尺寸。
- 平台积分扣费和上游 USD 成本目前是两套逻辑：页面展示 USD 估算，后端按积分扣费。
- 支付仍是模拟/人工确认，不是生产级自动支付。
- `/uploads` 还不是强私有资源。
- 项目是单体应用，适合轻量部署；高并发商用前需要拆分任务队列、对象存储、支付服务和日志监控。
