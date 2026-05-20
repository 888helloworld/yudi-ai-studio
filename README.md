# 御弟哥哥，你的 AI 图文创作搭档

御弟哥哥是一个面向内容创作者、电商卖家、设计团队和运营人员的 AI 图文工作台。它不只服务小红书，也覆盖通用 AI 生图、参考图改图、批量测试、看图写 Prompt、DeepSeek 文案生成、积分/卡密运营和后台管理。

项目是一个轻量 Node.js 单体应用：前端使用原生 HTML/CSS/JavaScript，后端基于 Express、SQLite、JWT 和模型 API。它可以直接部署到单台服务器，也可以作为后续 SaaS 产品的核心底座。

## 核心能力

### 画面工坊：gpt-image-2 生图和改图

`image-studio.html` 是当前最重要的图片创作页面，面向通用出图、批量测试和参考图改图。

- 支持 `gpt-image-2` 文生图。
- 支持上传 1-4 张参考图进行改图。
- 支持粘贴图片、拖拽图片、点击上传图片。
- 支持 1:1、2:3、3:2 常用尺寸。
- 支持快速、标准、精细质量档位。
- 支持批量出图，出图组数最多可配置到 1000。
- 支持“同时开跑”并发配置。
- 支持生成记录分页、图片预览、下载、重新生图、复制提示词。
- 支持把已生成图片放回参考图继续改图。

服务端还有独立队列 `XI_XU_MAX_ACTIVE_JOBS`，设置为 `0` 表示不限制服务端同时运行的 gpt-image-2 图片任务。

### DeepSeek 文案和内容创作

首页和小红书工作台集成 DeepSeek 文案能力，用于日常内容生产。

- 小红书风格图片生成。
- 小红书标题、正文和标签生成。
- 文案改写、结构优化和语气调整。
- 图文一体生成：同时生成配图和配套文案。
- 文案模型可通过 `DEEPSEEK_TEXT_MODEL` 配置，当前默认 `deepseek-v4-pro`。

这些能力可以继续扩展到 TikTok、Instagram、Amazon、独立站、电商详情页、广告素材和短视频封面等场景。

### 看图写 Prompt

“看图写 Prompt”用于上传图片后反推出可复用提示词，适合学习参考图的构图、光线、材质和商业摄影表达。

内置模板包括：

- 通用拆解：拆主体、场景、构图、光线、色彩、材质、镜头、风格和负面词。
- 亚马逊主图：适合清洁用品、家居用品、服饰配件等产品主图。
- 模特穿搭：适合服饰、鞋履、裙装搭配等电商图片。
- 只取风格：学习参考图的视觉风格，但不复制人物、品牌、logo 或独特设计。
- 精准拆图：结构化输出主体、背景、构图、镜头、光线、颜色、材质、风格、细节、画质关键词和负面词。

反推结果默认只展示：

- 中文 Prompt
- 英文 Prompt

中文和英文 Prompt 下方都有“用它生图”按钮，点击后会直接填入画面工坊的图片描述框。

### 账号、积分和后台

- 用户注册、登录和 JWT 鉴权。
- 用户积分余额和积分流水。
- 生成任务按积分扣费。
- 失败任务自动退款。
- 卡密兑换。
- 模拟支付订单。
- 个人中心。
- 管理后台：用户、历史、积分流水、卡密、支付订单和统计数据。

注意：当前支付仍是模拟订单流程，适合内部测试。生产环境正式收费前，必须接入支付宝/微信等真实支付平台回调和验签逻辑。

## 适用场景

- 内容创作者：快速生成封面、配图、标题和笔记文案。
- 电商卖家：生成商品主图、商品场景图、模特穿搭图和详情页素材。
- 设计团队：沉淀 Prompt，批量测试风格，复用生成记录。
- 小商家：围绕商品、门店、活动快速产出推广素材。
- 运营团队：管理账号、积分、卡密和历史资产。

## 技术栈

- Runtime: Node.js
- Backend: Express
- Database: SQLite / better-sqlite3
- Auth: JWT
- Upload: Multer 2.x
- Frontend: 原生 HTML、CSS、JavaScript
- Text model: DeepSeek
- Image model: gpt-image-2 / 火山引擎图片接口
- Process manager: PM2
- Reverse proxy: nginx

## 主要页面

| 页面 | 说明 |
| --- | --- |
| `index.html` | 首页和内容创作入口 |
| `xhs.html` | 小红书图文创作工作台 |
| `image-studio.html` | 画面工坊：gpt-image-2 生图、参考图改图、看图写 Prompt、生成记录 |
| `xi-image.html` | 旧入口跳转页，自动跳转到 `image-studio.html` |
| `reverse-prompt.html` | 独立图片反推提示词页面 |
| `profile.html` | 个人中心 |
| `admin.html` | 管理后台 |
| `login.html` / `register.html` | 登录和注册 |
| `help.html` | 使用帮助 |

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

如果使用 Windows 本地守护脚本：

```powershell
.\deploy\ensure-local-service.ps1
```

## 环境变量

复制 `.env.example` 为 `.env`，根据实际服务填写密钥。不要把真实 API Key、JWT 密钥、管理员密码提交到 Git。

核心配置：

```env
PORT=3001
ALLOWED_ORIGIN=http://localhost:3001

ARK_API_KEY=your_ark_api_key_here

DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_TEXT_MODEL=deepseek-v4-pro

XI_XU_API_BASE_URL=https://api.xi-xu.me
XI_XU_API_KEY=your_image_api_key_here
XI_XU_IMAGE_MODEL=gpt-image-2
XI_XU_VISION_MODEL=gpt-5.5
XI_XU_RESPONSES_MODEL=gpt-5.4-mini
XI_XU_MAX_ACTIVE_JOBS=0
XI_XU_IMAGE_RATE_LIMIT_PER_MIN=30

JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d

ENABLE_MOCK_PAYMENT=false
MOCK_PAYMENT_TOKEN=replace_with_a_long_random_token

ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace_with_a_strong_password
```

生产环境建议额外设置：

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
```

## 并发配置

项目有两层并发控制：

- 前端“同时开跑”控制浏览器侧提交任务的数量。
- 服务端 `XI_XU_MAX_ACTIVE_JOBS` 控制真正同时运行的 gpt-image-2 图片任务。
- `XI_XU_MAX_ACTIVE_JOBS=0` 表示服务端不设并发上限。
- `XI_XU_IMAGE_RATE_LIMIT_PER_MIN=30` 控制图片任务接口每分钟请求数，避免误操作或账号被盗后快速打满额度。

实际并发仍会受到浏览器连接数、服务器带宽、上游 API 限流和超时影响。

## 安全说明

当前已做的安全加固：

- 生产环境没有 `JWT_SECRET` 会拒绝启动。
- `ENABLE_MOCK_PAYMENT` 默认关闭，模拟支付回调默认不可用。
- 模拟支付回调即使开启，也必须配置 `MOCK_PAYMENT_TOKEN`。
- gpt-image-2 接口默认限流为 `30/分钟`。
- 用户分页 `limit` 最大 100，后台分页 `limit` 最大 200。
- `/uploads` 响应头添加 `Cache-Control: private`、`X-Content-Type-Options: nosniff`、`X-Robots-Tag: noindex`。
- 关闭 `X-Powered-By`，减少技术栈指纹暴露。
- 上传文件有大小限制、MIME 白名单和文件头校验。
- `multer` 已升级到 2.x。
- 官方 npm registry 下 `npm audit` 当前为 0 vulnerabilities。

仍需注意：

- `/uploads` 目前仍然是“知道链接即可访问”，不是彻底私有。如果业务涉及客户隐私图、人脸图、未公开商品设计，应升级为鉴权图片代理或签名 URL。
- 当前支付是模拟订单，生产环境正式收费前必须接入真实支付回调和平台验签。
- JWT 当前保存在浏览器 `localStorage`，如果未来出现 XSS，token 有泄露风险。后续可升级为 HttpOnly Cookie，并进一步收紧 CSP。

## 部署

部署文档见：

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

当前部署策略：

- 本地代码是代码源。
- 云端保留运行数据：`.env`、`data.db`、`uploads/`。
- 正常部署不会覆盖云端数据库、用户、积分、历史和图片。

执行部署：

```powershell
.\deploy\deploy.ps1
```

只在首次安装或明确恢复数据时，才使用包含运行数据的部署方式。

## 数据和备份

以下文件不会提交到 Git，也不会在正常部署中覆盖云端：

- `.env`
- `data.db`
- `uploads/`
- `logs/`
- `node_modules/`
- `history.json`

建议生产环境定期备份：

- SQLite 数据库：`data.db`
- 用户上传和生成图片：`uploads/`
- 云端 `.env`

## 项目文档

- [产品框架](docs/PRODUCT_FRAMEWORK.md)
- [指标和埋点](docs/METRICS_AND_EVENTS.md)
- [迭代路线](docs/ROADMAP.md)
- [发布验收清单](docs/RELEASE_CHECKLIST.md)
- [部署说明](docs/DEPLOYMENT.md)

## 常用命令

代码检查：

```bash
npm run check
```

依赖安全审计：

```bash
npm audit --registry=https://registry.npmjs.org --audit-level=moderate
```

查看 Git 状态：

```bash
git status --short --branch
```

推送到 GitHub：

```bash
git push
```

部署到云端：

```powershell
.\deploy\deploy.ps1
```
