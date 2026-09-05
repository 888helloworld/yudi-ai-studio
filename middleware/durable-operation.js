const crypto = require('node:crypto');
const context = require('../services/operation-context');
const operations = require('../repositories/operation-repository');

const ENDPOINTS = new Set(['/generate', '/generate-copy', '/rewrite', '/generate-both',
  '/api/amazon-image/generate', '/api/xi-image/generate', '/api/xi-image/edit',
  '/api/xi-image/reverse-prompt', '/api/xi-image/polish-prompt']);

function requestFingerprint(req) {
  const body = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => !['clientTaskId', 'clientRequestId'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
  const hash = crypto.createHash('sha256').update(JSON.stringify(body));
  for (const file of (req.files || (req.file ? [req.file] : []))) hash.update(file.buffer);
  return hash.digest('hex');
}

function durableOperation(req, res, next) {
  if (req.method !== 'POST' || !ENDPOINTS.has(req.path)) return next();
  const state = { req, operation: null, duplicate: false, requestFingerprint };
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (state.operation && !state.duplicate) {
      const op = operations.settleOperation(state.operation.id, body, res.statusCode < 400);
      body = op.result ? JSON.parse(op.result) : body;
    } else if (state.operation) {
      body = { ...body, task: operations.serializeOperation(operations.getOperation(state.operation.id)) };
    }
    return originalJson(body);
  };
  return context.run(state, next);
}

module.exports = { durableOperation };
