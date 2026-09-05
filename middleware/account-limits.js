const rateLimit = require('express-rate-limit');

function accountLimit(max, windowMs = 15 * 60 * 1000) {
  return rateLimit({ windowMs, limit: max, keyGenerator: (req) => String(req.userId),
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: '操作过于频繁，请稍后再试' } });
}
module.exports = { accountLimit };
