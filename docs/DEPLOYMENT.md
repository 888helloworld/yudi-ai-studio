# Deployment

This project uses a simple source-of-truth rule:

- Local files are the source of truth for application code, HTML, CSS, docs, and deployment scripts.
- The server is the source of truth for runtime data: `.env`, `data.db`, `uploads/`, and PM2/nginx runtime state.
- Do not overwrite server runtime data from local files unless you are intentionally restoring or migrating data.

## Server Configuration

- Deployment URL: `https://your-domain.example/`
- SSH user: `deploy-user`
- App directory: `/var/www/your-app`
- PM2 app: `your-pm2-app`
- App port: `3001`
- nginx site proxies `https://your-domain.example/` to `127.0.0.1:3001`
- nginx site can include `client_max_body_size 25m;` for image uploads used by "看图写 Prompt"

## Deploy Code

Run from the project root on Windows:

```powershell
.\deploy\deploy.ps1
```

The script packages and uploads code, then runs `npm ci --omit=dev` and restarts only the `xiaohongshu-image-tool` PM2 app.

By default it excludes:

- `.env`
- `data.db`
- `uploads/`
- `node_modules/`
- local editor/tool folders and logs

This keeps cloud secrets, users, points, history, and generated images intact.

## Runtime Data

The server `.env` must contain:

```env
PORT=3001
ALLOWED_ORIGIN=https://your-domain.example,https://your-domain.example:3001,http://your-domain.example
ARK_API_KEY=...
DEEPSEEK_API_KEY=...
DEEPSEEK_TEXT_MODEL=deepseek-v4-pro
XI_XU_API_BASE_URL=https://api.xi-xu.me
XI_XU_API_KEY=...
XI_XU_IMAGE_MODEL=gpt-image-2
XI_XU_VISION_MODEL=gpt-5.5
XI_XU_MAX_ACTIVE_JOBS=0
XI_XU_IMAGE_RATE_LIMIT_PER_MIN=30
JWT_SECRET=...
NODE_ENV=production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=...
```

Do not commit real keys into the project. Keep production values only on the server.

## Include Runtime Data Deliberately

Only for an intentional first install or restore, pass:

```powershell
.\deploy\deploy.ps1 -IncludeRuntimeData
```

This can overwrite or mix server data, so avoid it for normal updates.

## Quick Checks

```powershell
curl.exe -I https://your-domain.example/
ssh -i C:\path\to\private-key.pem user@your-server.example "sudo env PATH=/root/.nvm/versions/node/v22.22.2/bin:\$PATH pm2 list"
```
