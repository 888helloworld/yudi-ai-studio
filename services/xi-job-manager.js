const crypto = require('crypto');
const { updateXiJobHistory: persistXiJobHistory } = require('../repositories/xi-history-repository');

const XI_JOB_CLEANUP_DELAY_MS = 10 * 60 * 1000;

function createXiJobManager({ db, maxActiveJobs = Number.POSITIVE_INFINITY, maxJobsPerUser = 0, maxQueuedJobs = 20, formatDateTime, runJob, getModel }) {
  const jobs = new Map();
  const queue = [];
  const cleanupTimers = new Map();
  let activeJobs = 0;

  function assertCanCreateJob(userId) {
    if (maxJobsPerUser > 0) {
      const userActiveJobs = Array.from(jobs.values()).filter((job) => (
        job.userId === userId && ['queued', 'running'].includes(job.status)
      )).length;
      if (userActiveJobs >= maxJobsPerUser) {
        const error = new Error(`每个账号最多同时处理 ${maxJobsPerUser} 个画面工坊任务，请等待当前任务完成`);
        error.statusCode = 429;
        throw error;
      }
    }
    if (queue.length >= maxQueuedJobs) {
      const error = new Error('画面工坊当前排队任务较多，请稍后再试');
      error.statusCode = 503;
      throw error;
    }
  }

  function getHistorySubType(job) {
    return job.mode === 'edit' ? 'xi-edit' : 'xi-generate';
  }

  function buildJobHistoryContent(job, status, extra = {}) {
    const durationMs = job.finishedAtMs && job.startedAtMs ? job.finishedAtMs - job.startedAtMs : 0;
    return JSON.stringify({
      status,
      model: getModel(),
      provider: job.provider || '',
      fallback_reason: job.fallbackReason || '',
      quality: job.quality,
      requested_quality: job.upstreamMeta?.requested_quality || job.quality,
      actual_quality: job.upstreamMeta?.actual_quality || '',
      requested_size: job.upstreamMeta?.requested_size || job.size,
      actual_size: job.upstreamMeta?.actual_size || '',
      billing_output_tokens: job.upstreamMeta?.billing_output_tokens || 0,
      usage_output_tokens: job.upstreamMeta?.usage_output_tokens || 0,
      billing_mode: job.upstreamMeta?.billing_mode || '',
      billing_note: job.upstreamMeta?.billing_note || '',
      image_parameter_mode: job.upstreamMeta?.image_parameter_mode || '',
      image_parameter_note: job.upstreamMeta?.image_parameter_note || '',
      size_source: job.upstreamMeta?.size_source || '',
      size_parameter_affects_output_guarantee: job.upstreamMeta?.size_parameter_affects_output_guarantee,
      quality_parameter_affects_output_guarantee: job.upstreamMeta?.quality_parameter_affects_output_guarantee,
      count: job.count,
      sources: job.sourceFileNames || [],
      source_urls: job.sourcePreviewUrls || [],
      source_dimensions: job.sourceDimensions || [],
      output_dimensions: job.outputDimensions || [],
      duration_ms: durationMs,
      error: job.error || '',
      refunded_points: job.refundedPoints || 0,
      ...extra
    });
  }

  function createJobHistory(job) {
    job.historyId = db.addHistory(job.userId, 'image', {
      sub_type: getHistorySubType(job),
      image_url: null,
      content: buildJobHistoryContent(job, 'queued'),
      prompt: job.prompt,
      ratio: job.size,
      cost_points: job.costPoints || 0
    });
  }

  function updateJobHistory(job, status, imageUrls, costPoints, extra = {}) {
    if (!job.historyId) return false;
    try {
      persistXiJobHistory({
        historyId: job.historyId,
        userId: job.userId,
        content: buildJobHistoryContent(job, status, extra),
        imageUrls,
        costPoints
      });
      return true;
    } catch (historyErr) {
      console.error('更新 gpt-image-2 任务历史失败:', historyErr);
      return false;
    }
  }

  function saveFailureHistory(job) {
    const durationMs = job.finishedAtMs && job.startedAtMs ? job.finishedAtMs - job.startedAtMs : 0;
    if (updateJobHistory(job, 'failed', [], 0, {
      duration_ms: durationMs,
      error: job.error || '任务失败',
      refunded_points: job.refundedPoints || 0
    })) {
      return job.historyId;
    }
    try {
      job.historyId = db.addHistory(job.userId, 'image', {
        sub_type: getHistorySubType(job),
        image_url: null,
        content: JSON.stringify({
          status: 'failed',
          model: getModel(),
          provider: job.provider || '',
          fallback_reason: job.fallbackReason || '',
          quality: job.quality,
          count: job.count,
          sources: job.sourceFileNames || [],
          source_urls: job.sourcePreviewUrls || [],
          source_dimensions: job.sourceDimensions || [],
          output_dimensions: job.outputDimensions || [],
          duration_ms: durationMs,
          error: job.error || '任务失败',
          refunded_points: job.refundedPoints || 0
        }),
        prompt: job.prompt,
        ratio: job.size,
        cost_points: 0
      });
    } catch (historyErr) {
      console.error('保存 gpt-image-2 失败历史失败:', historyErr);
    }
    return job.historyId;
  }

  function scheduleJobs() {
    while (activeJobs < maxActiveJobs && queue.length > 0) {
      const job = queue.shift();
      if (!job || !jobs.has(job.id) || job.status !== 'queued') continue;
      activeJobs += 1;
      runJob(job)
        .catch((err) => {
          console.error('gpt-image-2 任务运行异常:', err);
        })
        .finally(() => {
          activeJobs = Math.max(0, activeJobs - 1);
          scheduleJobs();
        });
    }
  }

  function enqueueJob(job) {
    queue.push(job);
    scheduleJobs();
  }

  function createJob(userId, payload) {
    const now = Date.now();
    const job = {
      id: `xijob_${now}_${crypto.randomBytes(4).toString('hex')}`,
      userId,
      status: 'queued',
      createdAtMs: now,
      startedAtMs: 0,
      finishedAtMs: 0,
      imageUrls: [],
      error: '',
      historyId: null,
      ...payload
    };
    createJobHistory(job);
    jobs.set(job.id, job);
    enqueueJob(job);
    return job;
  }

  function restoreJob(job) {
    jobs.set(job.id, job);
    enqueueJob(job);
    return job;
  }

  function serializeJob(job) {
    const durationMs = job.startedAtMs
      ? ((job.finishedAtMs || (job.status === 'running' ? Date.now() : 0)) - job.startedAtMs)
      : 0;
    return {
      id: job.id,
      status: job.status,
      mode: job.mode,
      prompt: job.prompt,
      size: job.size,
      count: job.count,
      quality: job.quality,
      upstreamMeta: job.upstreamMeta || {},
      sourceFileNames: job.sourceFileNames || [],
      sourcePreviewUrls: job.sourcePreviewUrls || [],
      sourceDimensions: job.sourceDimensions || [],
      outputDimensions: job.outputDimensions || [],
      createdAtMs: job.createdAtMs,
      createdAt: formatDateTime(new Date(job.createdAtMs), { date: false }),
      startedAtMs: job.startedAtMs,
      finishedAtMs: job.finishedAtMs,
      durationMs: Math.max(durationMs, 0),
      imageUrls: job.imageUrls || [],
      imageUrl: job.imageUrls?.[0] || '',
      error: job.error || '',
      historyId: job.historyId,
      costPoints: job.costPoints || 0,
      refundedPoints: job.refundedPoints || 0,
      provider: job.provider || '',
      fallbackReason: job.fallbackReason || '',
      remainingPoints: db.getUserPoints(job.userId),
      model: getModel()
    };
  }

  function listActiveJobsForUser(userId) {
    return Array.from(jobs.values())
      .filter((job) => job.userId === userId && ['queued', 'running'].includes(job.status))
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .map(serializeJob);
  }

  function getUserJob(userId, jobId) {
    const job = jobs.get(jobId);
    return job && job.userId === userId ? job : null;
  }

  function canUserAccessUpload(userId, filename) {
    if (db.userOwnsUpload(userId, filename)) return true;
    for (const job of jobs.values()) {
      if (job.userId !== userId) continue;
      const outputUrls = Array.isArray(job.imageUrls) ? job.imageUrls : [];
      const sourceUrls = Array.isArray(job.sourcePreviewUrls) ? job.sourcePreviewUrls : [];
      if ([...outputUrls, ...sourceUrls].some((url) => String(url || '') === `/uploads/${filename}`)) {
        return true;
      }
    }
    return false;
  }

  function scheduleCleanup(job) {
    if (Array.isArray(job.sourceFiles)) {
      job.sourceFiles.forEach((file) => {
        if (file) file.buffer = null;
      });
    }
    if (cleanupTimers.has(job.id)) return;
    const timer = setTimeout(() => {
      jobs.delete(job.id);
      cleanupTimers.delete(job.id);
    }, XI_JOB_CLEANUP_DELAY_MS);
    cleanupTimers.set(job.id, timer);
  }

  return {
    assertCanCreateJob,
    buildJobHistoryContent,
    canUserAccessUpload,
    createJob,
    getHistorySubType,
    getUserJob,
    listActiveJobsForUser,
    restoreJob,
    saveFailureHistory,
    scheduleCleanup,
    serializeJob,
    updateJobHistory
  };
}

module.exports = {
  createXiJobManager
};
