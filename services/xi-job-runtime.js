const crypto = require('crypto');
const fs = require('fs');
const { POINTS } = require('../config/points');
const { sniffImageMime } = require('../middleware/image-upload');
const {
  getRecoverableXiJobHistories,
  updateXiHistoryState
} = require('../repositories/xi-history-repository');
const { getSourceImageFilename } = require('./prompt-service');
const { createXiJobManager } = require('./xi-job-manager');
const { assertXiImageSizeSupported, parseXiImageSize } = require('./xi-image-size');
const { getLocalImageDimensions, getLocalUploadPath } = require('../utils/image-storage');
const { parseImageCount } = require('../utils/request-utils');

function getMaxActiveJobs() {
  const raw = String(process.env.XI_XU_MAX_ACTIVE_JOBS || '2').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 8) : 2;
}

function getPositiveJobLimit(name, fallback, maximum) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), maximum) : fallback;
}

function createXiJobRuntime({ db, provider, refundPoints, formatDateTime }) {
  const manager = createXiJobManager({
    db,
    maxActiveJobs: getMaxActiveJobs(),
    maxJobsPerUser: getPositiveJobLimit('XI_XU_MAX_ACTIVE_JOBS_PER_USER', 2, 5),
    maxQueuedJobs: getPositiveJobLimit('XI_XU_MAX_QUEUED_JOBS', 20, 100),
    formatDateTime,
    runJob: (job) => runXiJob(job),
    getModel: () => process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2'
  });

  function buildRecoveredSourceFiles(meta, mode) {
    if (mode !== 'edit') return [];
    const sourceUrls = Array.isArray(meta.source_urls) ? meta.source_urls : [];
    if (sourceUrls.length === 0) throw new Error('任务参考图记录不存在');
    const sourceNames = Array.isArray(meta.sources) ? meta.sources : [];
    return sourceUrls.map((url, index) => {
      const filepath = getLocalUploadPath(url);
      if (!filepath || !fs.existsSync(filepath)) throw new Error(`参考图${index + 1}文件不存在`);
      const buffer = fs.readFileSync(filepath);
      const mimetype = sniffImageMime(buffer);
      if (!mimetype) throw new Error(`参考图${index + 1}文件已损坏`);
      return { buffer, mimetype, originalname: sourceNames[index] || getSourceImageFilename(index) };
    });
  }

  function markRecoveryFailed(row, meta, reason) {
    const alreadyRefunded = Math.max(Number(meta.refunded_points) || 0, 0);
    const refundAmount = Math.max((Number(row.cost_points) || 0) - alreadyRefunded, 0);
    if (refundAmount > 0) {
      refundPoints(row.user_id, refundAmount, 'gpt-image-2 重启恢复失败退款', `xi-job-recovery-failure:${row.id}`);
    }
    meta.status = 'failed';
    meta.refunded_points = alreadyRefunded + refundAmount;
    meta.error = `服务重启后任务恢复失败，积分已自动退回：${reason}`;
    updateXiHistoryState(row.id, JSON.stringify(meta), null, 0);
  }

  function recoverStaleHistories() {
    let recovered = 0;
    let blocked = 0;
    try {
      for (const row of getRecoverableXiJobHistories(500)) {
        let meta = {};
        try { meta = JSON.parse(row.content || '{}'); } catch {}
        if (!['queued', 'running'].includes(meta.status)) continue;
        try {
          const mode = row.sub_type === 'xi-edit' ? 'edit' : 'generate';
          const prompt = String(row.prompt || '').trim();
          const size = parseXiImageSize(row.ratio || meta.requested_size || meta.actual_size);
          const count = parseImageCount(meta.count, 5);
          if (!prompt) throw new Error('任务提示词为空');
          assertXiImageSizeSupported(size);
          const sourceFiles = buildRecoveredSourceFiles(meta, mode);
          const costPoints = Math.max(Number(row.cost_points) || 0, 0);
          const refundedPoints = Math.max(Number(meta.refunded_points) || 0, 0);
          if (costPoints > 0 && refundedPoints >= costPoints) {
            throw new Error('任务积分已经全部退回，禁止重复恢复');
          }
          meta.status = 'queued';
          meta.error = '';
          updateXiHistoryState(row.id, JSON.stringify(meta), null);
          manager.restoreJob({
            id: `xijob_recovered_${row.id}_${crypto.randomBytes(4).toString('hex')}`,
            userId: row.user_id,
            status: 'queued',
            createdAtMs: Date.parse(row.created_at) || Date.now(),
            startedAtMs: 0,
            finishedAtMs: 0,
            imageUrls: [],
            error: '',
            historyId: row.id,
            mode,
            prompt,
            size,
            count,
            quality: provider.fixedQuality,
            costPoints,
            sourceFiles,
            sourceFileNames: Array.isArray(meta.sources) ? meta.sources : [],
            sourcePreviewUrls: Array.isArray(meta.source_urls) ? meta.source_urls : [],
            sourceDimensions: Array.isArray(meta.source_dimensions) ? meta.source_dimensions : [],
            outputDimensions: [],
            upstreamMeta: {},
            provider: '',
            fallbackReason: '',
            refundedPoints,
            refundedOnFail: false
          });
          recovered += 1;
        } catch (error) {
          markRecoveryFailed(row, meta, error.message || '任务参数无效');
          blocked += 1;
        }
      }
      if (recovered > 0 || blocked > 0) {
        console.log(`已处理重启遗留的 gpt-image-2 任务：恢复 ${recovered} 条，无法恢复并退款 ${blocked} 条`);
      }
    } catch (error) {
      console.error('处理重启遗留 gpt-image-2 任务失败:', error);
    }
  }

  async function runXiJob(job) {
    job.status = 'running';
    job.startedAtMs = Date.now();
    manager.updateJobHistory(job, 'running', [], job.costPoints || 0);
    try {
      let localUrls;
      if (job.mode === 'edit') {
        const editResult = await provider.callXiXuEdit(job);
        localUrls = editResult.localUrls;
        job.upstreamMeta = editResult.upstreamMeta || {};
        job.provider = 'xixu';
        job.fallbackReason = '';
      } else {
        const generateResult = await provider.callXiXuGenerate(job);
        localUrls = generateResult.localUrls;
        job.upstreamMeta = generateResult.upstreamMeta || {};
        job.provider = 'xixu';
        job.fallbackReason = '';
      }
      job.status = 'done';
      job.finishedAtMs = Date.now();
      job.imageUrls = localUrls;
      job.outputDimensions = getLocalImageDimensions(localUrls);
      const durationMs = job.finishedAtMs - job.startedAtMs;
      const expectedCount = Math.max(Number(job.count) || 1, 1);
      const actualCount = Math.min(localUrls.length, expectedCount);
      const actualCost = POINTS.image * actualCount;
      const refundAmount = Math.max((job.costPoints || 0) - actualCost - (job.refundedPoints || 0), 0);
      if (refundAmount > 0) {
        refundPoints(job.userId, refundAmount, `gpt-image-2 少出${expectedCount - actualCount}张退款`, `xi-job-partial:${job.historyId}`);
        job.refundedPoints = (job.refundedPoints || 0) + refundAmount;
      }
      if (!manager.updateJobHistory(job, 'done', localUrls, actualCost, { duration_ms: durationMs })) {
        job.historyId = db.addHistory(job.userId, 'image', {
          sub_type: manager.getHistorySubType(job),
          image_url: JSON.stringify(localUrls),
          content: manager.buildJobHistoryContent(job, 'done', { duration_ms: durationMs }),
          prompt: job.prompt,
          ratio: job.size,
          cost_points: actualCost
        });
      }
    } catch (error) {
      const remainingRefund = Math.max((job.costPoints || 0) - (job.refundedPoints || 0), 0);
      if (remainingRefund > 0 && !job.refundedOnFail) {
        refundPoints(job.userId, remainingRefund, `gpt-image-2 ${job.mode === 'edit' ? '改图' : '生图'}失败退款`, `xi-job-failure:${job.historyId}`);
        job.refundedPoints = (job.refundedPoints || 0) + remainingRefund;
        job.refundedOnFail = true;
      }
      job.status = 'failed';
      job.finishedAtMs = Date.now();
      if (error.fallbackReason && !job.fallbackReason) job.fallbackReason = error.fallbackReason;
      job.error = error.message || '任务失败';
      console.error('gpt-image-2 任务失败:', JSON.stringify({
        id: job.id,
        mode: job.mode,
        size: job.size,
        quality: job.quality,
        count: job.count,
        durationMs: job.startedAtMs ? job.finishedAtMs - job.startedAtMs : 0,
        error: job.error
      }));
      manager.saveFailureHistory(job);
    }
    manager.scheduleCleanup(job);
  }

  function initializeRecovery() {
    recoverStaleHistories();
  }

  return { initializeRecovery, manager };
}

module.exports = { createXiJobRuntime };
