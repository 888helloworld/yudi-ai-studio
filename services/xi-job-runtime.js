const crypto = require('crypto');
const fs = require('fs');
const { POINTS } = require('../config/points');
const { sniffImageMime } = require('../middleware/image-upload');
const {
  createChargedXiJobHistory,
  getRecoverableXiJobHistories,
  settleXiJobHistory,
  updateXiHistoryState
} = require('../repositories/xi-history-repository');
const { getSourceImageFilename } = require('./prompt-service');
const { createXiJobManager } = require('./xi-job-manager');
const { assertXiImageSizeSupported, parseXiImageSize } = require('./xi-image-size');
const { getLocalImageDimensions, getLocalUploadPath } = require('../utils/image-storage');
const { parseImageCount } = require('../utils/request-utils');

function getMaxActiveJobs() {
  const raw = String(process.env.XI_XU_MAX_ACTIVE_JOBS ?? '0').trim();
  if (/^(unlimited|无限)$/i.test(raw)) return Number.POSITIVE_INFINITY;
  const parsed = Number(raw);
  if (parsed === 0) return Number.POSITIVE_INFINITY;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Number.POSITIVE_INFINITY;
}

function getJobLimit(name, fallback, maximum) {
  const raw = String(process.env[name] ?? '').trim();
  if (/^(unlimited|无限)$/i.test(raw)) return 0;
  const parsed = Number(raw);
  if (parsed === 0) return 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), maximum) : fallback;
}

function createXiJobRuntime({ db, provider, refundPoints, formatDateTime }) {
  const manager = createXiJobManager({
    db,
    maxActiveJobs: getMaxActiveJobs(),
    maxJobsPerUser: getJobLimit('XI_XU_MAX_ACTIVE_JOBS_PER_USER', 0, 1000),
    maxQueuedJobs: getJobLimit('XI_XU_MAX_QUEUED_JOBS', 20, 1000),
    formatDateTime,
    createHistory: (job) => createChargedXiJobHistory({
      job,
      content: manager.buildJobHistoryContent(job, 'queued')
    }),
    runJob: (job) => runXiJob(job),
    getModel: () => process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2'
  });

  function removeLocalOutputs(urls) {
    for (const url of Array.isArray(urls) ? urls : []) {
      const filepath = getLocalUploadPath(url);
      if (!filepath) continue;
      try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (error) {
        console.error('清理已删除任务输出失败:', error.message || error);
      }
      try {
        const thumbnail = `${filepath}.thumb.png`;
        if (fs.existsSync(thumbnail)) fs.unlinkSync(thumbnail);
      } catch {}
    }
  }

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
    meta.status = 'failed';
    meta.refunded_points = alreadyRefunded + refundAmount;
    meta.error = `服务重启后任务恢复失败，积分已自动退回：${reason}`;
    settleXiJobHistory({
      historyId: row.id,
      userId: row.user_id,
      content: JSON.stringify(meta),
      imageUrls: [],
      costPoints: 0,
      refundAmount,
      refundDescription: 'gpt-image-2 重启恢复失败退款'
    });
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
            refundedOnFail: false,
            clientTaskId: row.client_task_id || null
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
    let generatedUrls = [];
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
      generatedUrls = localUrls;
      job.status = 'done';
      job.finishedAtMs = Date.now();
      job.imageUrls = localUrls;
      job.outputDimensions = getLocalImageDimensions(localUrls);
      const durationMs = job.finishedAtMs - job.startedAtMs;
      const expectedCount = Math.max(Number(job.count) || 1, 1);
      const actualCount = Math.min(localUrls.length, expectedCount);
      const actualCost = POINTS.image * actualCount;
      const refundAmount = Math.max((job.costPoints || 0) - actualCost - (job.refundedPoints || 0), 0);
      const nextRefundedPoints = (job.refundedPoints || 0) + refundAmount;
      const settled = settleXiJobHistory({
        historyId: job.historyId,
        userId: job.userId,
        content: manager.buildJobHistoryContent(job, 'done', { duration_ms: durationMs, refunded_points: nextRefundedPoints }),
        imageUrls: localUrls,
        costPoints: actualCost,
        refundAmount,
        refundDescription: `gpt-image-2 少出${expectedCount - actualCount}张退款`
      });
      if (settled.updated) {
        job.refundedPoints = nextRefundedPoints;
      } else {
        removeLocalOutputs(localUrls);
        job.imageUrls = [];
        job.error = '任务记录已被删除，生成结果已清理';
      }
    } catch (error) {
      if (generatedUrls.length > 0) {
        removeLocalOutputs(generatedUrls);
        job.imageUrls = [];
      }
      const remainingRefund = Math.max((job.costPoints || 0) - (job.refundedPoints || 0), 0);
      const nextRefundedPoints = (job.refundedPoints || 0) + remainingRefund;
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
      try {
        const settled = settleXiJobHistory({
          historyId: job.historyId,
          userId: job.userId,
          content: manager.buildJobHistoryContent(job, 'failed', {
            error: job.error,
            refunded_points: nextRefundedPoints
          }),
          imageUrls: [],
          costPoints: 0,
          refundAmount: remainingRefund,
          refundDescription: `gpt-image-2 ${job.mode === 'edit' ? '改图' : '生图'}失败退款`
        });
        if (settled.updated) {
          job.refundedPoints = nextRefundedPoints;
          job.refundedOnFail = true;
        }
      } catch (settlementError) {
        console.error('gpt-image-2 失败结算暂未完成，将由重启恢复流程继续处理:', settlementError.message || settlementError);
      }
    } finally {
      manager.scheduleCleanup(job);
    }
  }

  function initializeRecovery() {
    recoverStaleHistories();
  }

  return { initializeRecovery, manager };
}

module.exports = { createXiJobRuntime };
