# 御弟哥哥 AI 图文创作工作台

御弟哥哥是一个面向内容创作者、电商运营、设计团队和商家用户的 AI 图文创作工具。它不只服务小红书场景，也覆盖通用 AI 生图、商品主图、模特穿搭图、图文内容生产、提示词反推、历史资产管理和积分运营。

项目是一个轻量 Node.js 单体应用，前端使用原生 HTML/CSS/JavaScript，后端使用 Express、SQLite 和 JWT。适合快速部署到单台服务器，也方便继续拆分成更完整的 SaaS 产品。

## 核心能力

### 御弟哥哥 · gpt-image-2 生图

`image-studio.html` 是当前最重要的图片创作页面，面向通用出图、批量测试和参考图改图。

- 支持 `gpt-image-2` 文生图。
- 支持上传 1-4 张参考图进行改图。
- 支持粘贴图片、拖拽图片、点击上传图片。
- 支持 1:1、2:3、3:2 常用尺寸。
- 支持快速、标准、精细质量档位。
- 支持批量出图，出图组数最多可配置到 1000。
- 支持“同时开跑”并发配置，前端不设上限。
- 支持生成记录分页、图片预览、下载、重新生图、复制提示词。
- 支持把已生成图片放回参考图继续改图。

服务端还有独立队列 `XI_XU_MAX_ACTIVE_JOBS`，设置为 `0` 表示不限制服务端同时运行的 gpt-image-2 图片任务。

### 看图写 Prompt

“看图写 Prompt”用于上传图片后反推出可复用提示词，适合学习参考图的构图、光线、材质和商业摄影表达。

内置模板包括：

- 通用拆解：拆主体、场景、构图、光线、色彩、材质、镜头、风格和负面词。
- 亚马逊主图：适合袜子、足袋袜、魔力抹布、家居类产品主图。
- 模特穿搭：适合日本亚马逊足袋袜、堆堆袜、裙子搭配图。
- 只取风格：学习同行爆款图的视觉风格，但不复制人物、品牌、logo 或独特设计。
- 精准拆图：结构化输出主体、背景、构图、镜头、光线、颜色、材质、风格、细节、画质关键词和负面词。
- 足袋袜主图：内置 split toe tabi socks、分趾结构、罗纹纹理、纯白背景、1:1 构图、亚马逊主图限制和专用负面词。

反推结果默认只展示：

- 中文 Prompt
- 英文 Prompt

中文和英文 Prompt 下方都有“用它生图”按钮，点击后会直接填入“画面工坊”的图片描述框。

### 内容创作工作台

首页和传统工作台保留了面向内容运营的图文能力：

- 小红书风格图片生成。
- 爆款文案生成。
- 文案改写。
- 图文一体生成。
- 历史记录查看和复用。

这些能力可以继续扩展到 TikTok、Instagram、Amazon、独立站、电商详情页、广告素材和短视频封面等场景。

### 账号、积分和后台

- 用户注册、登录和 JWT 鉴权。
- 用户积分余额和积分流水。
- 生成任务按积分扣费。
- 失败任务自动退款。
- 卡密兑换。
- 模拟支付订单。
- 个人中心。
- 管理后台：用户、历史、积分流水、卡密、支付订单和统计数据。

## 适用场景

- 内容创作者：快速生成封面、配图、标题和笔记文案。
- 电商卖家：生成亚马逊主图、商品场景图、模特穿搭图和详情页素材。
- 设计团队：沉淀 Prompt，批量测试风格，复用生成记录。
- 小商家：围绕商品、门店、活动快速产出推广素材。
- 运营团队：管理账号、积分、卡密和历史资产。

## 技术栈

- Runtime: Node.js
- Backend: Express
- Database: SQLite / better-sqlite3
- Auth: JWT
- Upload: Multer
- Frontend: 原生 HTML、CSS、JavaScript
- Process manager: PM2
- Reverse proxy: nginx

## 主要页面

- `index.html`：首页和内容创作入口。
- `image-studio.html`：御弟哥哥 · gpt-image-2 生图、参考图改图、看图写 Prompt、生成记录。
- `reverse-prompt.html`：独立图片反推提示词页面。
- `profile.html`：个人中心。
- `admin.html`：管理后台。
- `login.html` / `register.html`：登录和注册。
- `help.html`：使用帮助。

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

如果使用本地守护脚本：

```powershell
.\deploy\ensure-local-service.ps1
```

## 环境变量

复制 `.env.example` 为 `.env`，根据实际服务填写密钥。

核心配置：

```env
PORT=3001
ALLOWED_ORIGIN=http://localhost:3001

ARK_API_KEY=
DEEPSEEK_API_KEY=
DEEPSEEK_TEXT_MODEL=deepseek-v4-pro

XI_XU_API_BASE_URL=https://api.xi-xu.me
XI_XU_API_KEY=
XI_XU_IMAGE_MODEL=gpt-image-2
XI_XU_VISION_MODEL=gpt-5.5
XI_XU_MAX_ACTIVE_JOBS=0

JWT_SECRET=
JWT_EXPIRES_IN=7d

ADMIN_USERNAME=admin
ADMIN_PASSWORD=
```

并发说明：

- 前端“同时开跑”控制浏览器侧提交任务的数量。
- 服务端 `XI_XU_MAX_ACTIVE_JOBS` 控制真正同时运行的 gpt-image-2 图片任务。
- `XI_XU_MAX_ACTIVE_JOBS=0` 表示服务端不设并发上限。
- 实际并发仍可能受到浏览器连接数、服务器带宽、上游 API 限流和超时影响。

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

## 数据和安全

以下文件不会提交到 Git，也不会在正常部署中覆盖云端：

- `.env`
- `data.db`
- `uploads/`
- `logs/`
- `node_modules/`
- `history.json`

注意事项：

- 不要把真实 API Key 写入仓库。
- 生产环境必须使用强 JWT_SECRET。
- 上传目录和数据库应做定期备份。
- 如果接入真实支付，需要实现平台回调验签。
- 如果开放公网注册，应增加更严格的风控、限流和审计。

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

查看 Git 状态：

```bash
git status --short --branch
```

推送到 GitHub：

```bash
git push
```

