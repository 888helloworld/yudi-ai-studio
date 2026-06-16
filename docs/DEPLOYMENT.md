# 部署说明

这份文档讲一件事：怎么把“御弟哥哥”更新到服务器，同时不把用户、积分、历史、图片这些运行数据弄丢。

项目是一个轻量 Node.js 单体应用，代码可以反复部署，运行数据要小心保护。

## 核心原则

记住这条就不容易出事：

- 本地仓库是代码源：`server.js`、页面、样式、脚本、`docs/`、部署脚本。
- 服务器是运行数据源：`.env`、`data.db`、`uploads/`、日志、PM2/nginx 状态。
- 正常部署只更新代码，不覆盖服务器上的用户、积分、历史、图片。
- 只有首次安装、迁移或明确恢复数据时，才允许带运行数据部署。

## 不要提交的东西

这些东西不要写进 GitHub，也不要放进公开文档：

- 真实 API Key
- JWT 密钥
- 管理员密码
- 支付密钥
- 支付回调保护令牌
- 服务器 IP、SSH 用户、私钥路径
- 生产域名和内部路径
- 真实 `.env`
- 生产 `data.db`
- 用户上传和生成图片

公开仓库只能放占位符，例如：

```env
XI_XU_API_KEY=your_xi_xu_api_key_here
JWT_SECRET=replace_with_a_long_random_secret
```

## 生产环境配置

服务器上的 `.env` 至少要覆盖下面这些配置：

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
ALLOWED_ORIGIN=https://your-domain.example

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
LOCAL_REGISTER_WITHOUT_INVITE=false

ENABLE_MOCK_PAYMENT=false
MOCK_PAYMENT_TOKEN=replace_with_a_long_random_token
PAYMENT_PROVIDER=mock
PUBLIC_BASE_URL=https://your-domain.example
```

如果走官方 OpenAI 图片接口，也可以配置：

```env
OPENAI_IMAGE_API_BASE_URL=https://api.openai.com
OPENAI_IMAGE_API_KEY=your_openai_api_key
```

只要配置了 `OPENAI_IMAGE_API_KEY` 或 `OPENAI_IMAGE_API_BASE_URL`，图片请求会优先使用这组配置；否则使用 `XI_XU_API_BASE_URL` 和 `XI_XU_API_KEY`。

## 图片尺寸和部署注意点

当前画面工坊页面显示的是实测出图尺寸：

| 页面显示 | 实际出图尺寸 | 请求上游尺寸 |
| --- | --- | --- |
| 1:1 方图 | `1254x1254` | `1024x1024` |
| 2:3 竖图 | `1024x1536` | `1024x1536` |
| 3:2 横图 | `1536x1024` | `1536x1024` |
| 16:9 横图 | `1672x941` | `2560x1440` |

4K 已从页面去掉。当前上游请求 `3840x2160` 和 `2560x1440` 都返回 `1672x941`，保留 4K 按钮会误导用户。

默认不要开启：

```env
XI_XU_NORMALIZE_OUTPUT_SIZE=true
```

这个配置会把上游返回图规整到请求尺寸，可能改变画布。现在默认策略是：上游尺寸不匹配也保存原图并回传。

## 正常部署代码

在 Windows 本地项目根目录执行：

```powershell
.\deploy\deploy.ps1
```

脚本会打包代码、上传到服务器、执行依赖安装并重启 PM2 应用。

默认排除：

- `.env`
- `data.db`
- `uploads/`
- `node_modules/`
- `logs/`
- 本地编辑器和工具目录

这样可以保证云端密钥、用户、积分、历史、图片不会被本地文件覆盖。

## 首次安装或恢复数据

只有明确需要初始化或恢复运行数据时才使用：

```powershell
.\deploy\deploy.ps1 -IncludeRuntimeData
```

这会把运行数据也带上，有覆盖或混入服务器数据的风险。日常更新不要用。

## 本地运行

安装依赖：

```bash
npm install
```

启动服务：

```bash
npm start
```

访问：

```text
http://localhost:3001
```

语法检查：

```bash
npm run check
```

Windows 本地保活脚本：

```powershell
.\deploy\ensure-local-service.ps1
```

## 部署后检查

基本检查：

```powershell
curl.exe -I https://your-domain.example/
```

如果有 SSH 权限，可以看 PM2：

```powershell
ssh user@your-server "pm2 list"
```

页面检查：

- 首页能打开。
- 登录页能打开。
- 本地/内网注册是否免邀请码符合预期。
- 公网注册是否仍需要邀请码。
- 画面工坊能打开。
- 尺寸按钮只显示当前 4 个规格，不显示 4K。
- 管理后台能登录。
- 上游 ping 可用。

功能检查：

- 文生图能创建任务。
- 改图能上传 1-4 张参考图。
- 图片尺寸不匹配时仍回传图片。
- 失败任务会退积分。
- 历史记录能看到真实输出尺寸。
- 看图写 Prompt 能返回中文/英文提示词。

## 备份建议

生产环境至少定期备份：

- `data.db`
- `uploads/`
- 云端 `.env`

备份文件不要放进公开仓库。`data.db` 里有用户、积分、历史、订单等业务数据；`uploads/` 里有用户上传图和生成图。
