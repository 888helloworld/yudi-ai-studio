require('dotenv').config();
const { productionChecks } = require('../services/production-checks');
const checks = productionChecks();
for (const check of checks) console.log(`${check.ok ? '通过' : '待配置'}：${check.name} — ${check.detail}`);
if (process.argv.includes('--strict') && checks.some(check => !check.ok)) process.exitCode = 1;
