# Deployment

This project uses a simple source-of-truth rule:

- Local files are the source of truth for application code, HTML, CSS, docs, and deployment scripts.
- The server is the source of truth for runtime data: `.env`, `data.db`, `uploads/`, and PM2/nginx runtime state.
- Do not overwrite server runtime data from local files unless you are intentionally restoring or migrating data.

## Server Configuration

Do not commit real API keys, payment secrets, callback protection tokens, server addresses, SSH users, private paths, or production ports.

Use placeholders in documentation and pass real deployment values only through local commands, private notes, or server-side environment variables. Public repository docs should describe the deployment shape without publishing private infrastructure details.

## Deploy Code

Run from the project root on Windows:

```powershell
.\deploy\deploy.ps1
```

The script packages and uploads code, then runs `npm ci --omit=dev` and restarts the configured PM2 app.

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
ALLOWED_ORIGIN=https://your-domain.example
ARK_API_KEY=...
DEEPSEEK_API_KEY=...
DEEPSEEK_TEXT_MODEL=deepseek-v4-pro
XI_XU_API_BASE_URL=https://your-image-api.example
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
ssh -i C:\path\to\private-key.pem user@your-server "pm2 list"
```
