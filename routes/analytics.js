const express = require('express');
const rateLimit = require('express-rate-limit');
const { addAnalyticsEvent } = require('../repositories/analytics-repository');

const ALLOWED_EVENTS = new Set([
  'signup_config_loaded', 'signup_submit', 'signup_failed',
  'image_job_submit', 'history_reuse', 'asset_download', 'payment_open'
]);

function createAnalyticsRouter({ optionalAuth }) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 60000, max: 30, message: { error: '事件上报过于频繁' } });
  router.post('/api/events', limiter, optionalAuth, (req, res) => {
    const eventName = String(req.body.eventName || req.body.name || '').trim();
    if (!ALLOWED_EVENTS.has(eventName)) return res.status(400).json({ error: '无效的事件类型' });
    addAnalyticsEvent({
      userId: req.userId || null,
      eventName,
      requestId: req.body.requestId || req.body.request_id,
      properties: req.body.properties
    });
    return res.status(204).end();
  });
  return router;
}

module.exports = { createAnalyticsRouter };
