# Project Memory

## Owner Preferences
- 完成修改后**必须自动推送到 GitHub**（`git push origin main`），不需要用户提醒
- 修改代码后要跑 `npm run check` 验证语法，再启动服务确认能正常运行
- 用大白话/表格形式沟通，不要用太多术语
- 平台是 Windows，用 `dir`/`findstr` 而非 `ls`/`grep`

## Project Overview
- 小红书图片工具（AI 生图 + 文案生成 + 支付积分系统）
- 技术栈：Express 4 + better-sqlite3 + JWT + multer + bcryptjs
- 端口默认 3001，监听 127.0.0.1
- API Key 全部存在本地 `.env`，不传到远程服务
- `.env` 从未进入 git 历史

## Architecture
- `server.js` — 主服务（路由、AI 代理、积分扣减、图片下载存储）
- `db.js` — 数据库（用户、积分、历史、卡密、支付订单）
- `middleware/auth.js` — JWT 鉴权中间件
- `routes/auth.js` — 注册/登录
- `routes/user.js` — 用户个人操作（积分、历史、邀请码、改密码）
- `routes/admin.js` — 管理后台接口（全部需 admin 角色）
- 前端是纯 HTML + JS（index.html/script.js/admin.html 等）

## Code Conventions
- 积分扣减统一用 `chargePoints` / `refundPoints`（server.js），配合 `charged` 标志位防重复退款
- 数据库操作用 better-sqlite3 参数化查询，禁止字符串拼接 SQL
- 涉及状态占位的操作（卡密兑换、支付到账）用 `UPDATE ... WHERE status=0 + changes===0` 防并发
- 上传文件做魔数嗅探（`sniffImageMime`），不只看扩展名
- 下载外部图片前校验非内网地址（`assertSafeExternalUrl`）
- 错误统一走 `handleRequestError` 中间件，业务错误设 `error.statusCode`
