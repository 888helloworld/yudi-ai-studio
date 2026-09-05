function productionChecks() {
  return [
    { name: '生产模式', ok: process.env.NODE_ENV === 'production', detail: '公网部署设置 NODE_ENV=production；本机开发可不设置' },
    { name: 'HTTPS 公网地址', ok: /^https:\/\/[^/]+/i.test(process.env.PUBLIC_BASE_URL || ''), detail: '配置 PUBLIC_BASE_URL，并在反向代理启用有效证书' },
    { name: '安全登录 Cookie', ok: process.env.AUTH_COOKIE_SECURE !== 'false' && (process.env.AUTH_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production'), detail: '生产环境禁止 AUTH_COOKIE_SECURE=false' },
    { name: '代理层数', ok: /^[1-3]$/.test(process.env.TRUST_PROXY_HOPS || ''), detail: '按实际反向代理层数设置 TRUST_PROXY_HOPS，通常为1；不要向公网开放 Node 端口' },
    { name: '关闭模拟支付', ok: process.env.ENABLE_MOCK_PAYMENT !== 'true', detail: '正式支付未开放，继续使用卡密兑换' },
    { name: '异地备份目录', ok: Boolean(process.env.BACKUP_MIRROR_DIR), detail: '配置独立磁盘或受控网络盘 BACKUP_MIRROR_DIR；仅本机备份不能抵御整机故障' }
  ];
}
module.exports = { productionChecks };
