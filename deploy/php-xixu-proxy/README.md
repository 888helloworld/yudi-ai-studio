# XiXu API Hong Kong PHP Proxy

This folder is a small PHP relay for shared hosting panels that only support FTP + PHP.

## Upload

Upload the whole `php-xixu-proxy` folder to the Hong Kong website root, for example:

```text
https://your-hk-domain.com/xixu-proxy/
```

The folder must contain:

```text
xixu-proxy/
  index.php
  .htaccess
```

## Configure

Edit `index.php` before uploading:

```php
$proxyToken = 'CHANGE_ME_TO_A_LONG_RANDOM_TOKEN';
```

Use a long random value. Do not commit the real token.

Then set Tencent Cloud `.env`:

```env
XI_XU_API_BASE_URL=https://your-hk-domain.com/xixu-proxy
XI_XU_PROXY_TOKEN=the_same_long_random_token
ARK_FALLBACK_ENABLED=false
```

Restart the Node service after changing `.env`.

## Requirements

- PHP with `curl` enabled.
- The Hong Kong host must allow outbound HTTPS requests to `https://api.xi-xu.me`.
- Apache rewrite should be enabled for `.htaccess`. If it is not enabled, use a URL style supported by the host such as `https://your-hk-domain.com/xixu-proxy/index.php`.

## Security

- The proxy only forwards `/v1/*` paths to `https://api.xi-xu.me`.
- Requests must include `X-XiXu-Proxy-Token`.
- It does not store API keys or generated images.
