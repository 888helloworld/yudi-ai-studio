    function enqueueTasks() {
      const prompt = promptEl.value.trim();
      if (!prompt) {
        setStatus('请先输入图片描述。', 'error');
        return;
      }

      const count = 1;
      const batchCount = clamp(Number(batchCountEl.value || 1), 1, MAX_BATCH_COUNT);
      const parallelism = getParallelism();
      const selectedSources = getSelectedSourceImages();
      const mode = selectedSources.length > 0 ? 'edit' : 'generate';
      countEl.value = count;
      batchCountEl.value = batchCount;
      updateBatchCountButtons();
      if (parallelismEl) parallelismEl.value = parallelism;
      updateEstimate();

      for (let i = 0; i < batchCount; i += 1) {
        const createdAtMs = Date.now();
        const taskSourcePreviewUrls = createTaskSourcePreviewUrls(selectedSources);
        const task = {
          id: 'xi-task-' + (++state.taskSeq),
          index: state.taskSeq,
          status: 'queued',
          mode,
          prompt,
          size: state.selectedSize,
          count,
          quality: state.quality,
          sourceFiles: selectedSources.map((source) => source.file),
          sourcePreviewUrls: taskSourcePreviewUrls,
          localSourcePreviewUrls: taskSourcePreviewUrls,
          sourceFileNames: selectedSources.map((source) => getSourceImageName(source.slotIndex ?? 0)),
          createdAt: formatBeijingTime(),
          createdAtMs,
          submittedAtMs: createdAtMs,
          startedAtMs: 0,
          finishedAtMs: 0,
          imageUrls: [],
          error: ''
        };
        state.tasks.unshift(task);
        state.queue.push(task);
      }

      state.taskPage = 1;
      renderTaskPage();
      setStatus(`已开始生成 ${batchCount} 张${mode === 'edit' ? '参考图改图' : '新图'}。`, 'ok');
      updateStats();
      resetImageForm();
      processQueue();
    }

    function resetImageForm() {
      promptEl.value = '';
      resetPromptPolish();
      sourceSlots.forEach((_, index) => clearSourceImage(index, { silent: true }));
      countEl.value = 1;
      batchCountEl.value = DEFAULT_BATCH_COUNT;
      updateBatchCountButtons();
      if (parallelismEl) parallelismEl.value = DEFAULT_PARALLELISM;
      state.selectedSize = DEFAULT_SIZE;
      state.quality = DEFAULT_QUALITY;
      document.querySelectorAll('#sizeSelector .ratio-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.size === DEFAULT_SIZE);
      });
      updateGenerateButton();
      updateEstimate();
    }

    function processQueue() {
      const parallelism = getParallelism();
      while (state.running < parallelism && state.queue.length > 0) {
        const task = state.queue.shift();
        runTask(task).catch((err) => {
          task.status = 'failed';
          task.finishedAtMs = Date.now();
          task.error = formatTaskError(err?.message || '任务失败');
          updateTaskCard(task);
          updateStats();
          setStatus(`#${task.index} 没生成成功，已继续下一个任务。`, 'error');
          setTimeout(processQueue, 0);
        });
      }
      updateStats();
    }

    async function runTask(task) {
      task.status = 'running';
      task.startedAtMs = Date.now();
      task.displayStartedAtMs = task.startedAtMs;
      task.finishedAtMs = 0;
      state.running += 1;
      updateTaskCard(task);
      startTaskTimer(task);
      updateStats();

      try {
        const data = await requestImageTask(task);
        task.status = 'done';
        const result = data.job || data;
        task.finishedAtMs = result.finishedAtMs || Date.now();
        task.durationMs = result.durationMs || task.durationMs || 0;
        task.imageUrls = result.imageUrls || [];
        task.sourceDimensions = result.sourceDimensions || task.sourceDimensions || [];
        task.outputDimensions = result.outputDimensions || task.outputDimensions || [];
        task.requestedQuality = result.upstreamMeta?.requested_quality || task.requestedQuality || task.quality;
        task.actualQuality = result.upstreamMeta?.actual_quality || task.actualQuality || '';
        task.actualSize = result.upstreamMeta?.actual_size || task.actualSize || '';
        task.billingOutputTokens = result.upstreamMeta?.billing_output_tokens || task.billingOutputTokens || 0;
        task.historyId = result.historyId || task.historyId || '';
        task.saved = Boolean(task.historyId);
        task.doneAt = result.createdAt || formatBeijingDateTime();
        setStatus(`#${task.index} 已出图，看看有没有顺眼的。`, 'ok');
      } catch (err) {
        task.status = 'failed';
        task.finishedAtMs = Date.now();
        task.error = formatTaskError(err?.message || '任务失败');
        setStatus(`#${task.index} 没生成成功，已继续下一个任务：${formatTaskError(task.error)}`, 'error');
      } finally {
        stopTaskTimer(task);
        state.running = Math.max(0, state.running - 1);
        updateTaskCard(task);
        updateStats();
        setTimeout(processQueue, 0);
      }
    }

    async function requestImageTask(task) {
      const submitResult = task.mode !== 'edit'
        ? await requestJson('/api/xi-image/jobs/generate', {
          prompt: task.prompt,
          size: task.size,
          count: task.count,
          quality: task.quality
        })
        : await submitEditJob(task);

      const job = submitResult.job;
      updateNavPoints(job.remainingPoints);
      task.jobId = job.id;
      task.historyId = job.historyId || task.historyId || '';
      if (task.historyId) task.index = task.historyId;
      task.sourcePreviewUrls = job.sourcePreviewUrls || task.sourcePreviewUrls || [];
      task.sourceFileNames = job.sourceFileNames || task.sourceFileNames || [];
      return waitServerJob(task);
    }

    async function submitEditJob(task) {
      const form = new FormData();
      form.append('prompt', task.prompt);
      form.append('size', task.size);
      form.append('count', String(task.count));
      form.append('quality', task.quality);
      (task.sourceFiles || []).forEach((file, index) => {
        form.append('image', file, task.sourceFileNames?.[index] || getSourceImageName(index));
      });

      const res = await fetch('/api/xi-image/jobs/edit', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: form
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          handleAuthExpired(data.error || '登录已过期，请重新登录。');
        }
        const detail = data.detail ? '：' + data.detail : '';
        throw new Error((data.error || '这次没生成成功') + detail);
      }
      return data;
    }

    function waitServerJob(task) {
      return new Promise((resolve, reject) => {
        pollServerJob(task, resolve, reject);
      });
    }

    async function pollServerJob(task, resolve, reject) {
      if (!task.jobId) return;
      try {
        const res = await fetch('/api/xi-image/jobs/' + encodeURIComponent(task.jobId), {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 404 || data.error === '任务不存在') {
            await handleMissingServerJob(task, resolve, reject);
            return;
          }
          if (res.status === 401) {
            handleAuthExpired(data.error || '登录已过期，请重新登录。');
          }
          throw new Error(data.error || '结果还没取到');
        }
        const job = data.job;
        const previousStatus = task.status;
        const previousImageCount = (task.imageUrls || []).length;
        const previousSourceSignature = (task.sourcePreviewUrls || []).join('|');
        const previousError = task.error || '';
        task.status = job.status;
        const submittedAtMs = parseServerJobSubmittedAtMs(job);
        task.createdAtMs = submittedAtMs || task.createdAtMs || 0;
        task.submittedAtMs = submittedAtMs || task.submittedAtMs || task.createdAtMs || 0;
        task.startedAtMs = job.startedAtMs || task.startedAtMs;
        task.finishedAtMs = job.finishedAtMs || task.finishedAtMs;
        task.durationMs = job.durationMs || task.durationMs || 0;
        if (task.status === 'running' && !task.displayStartedAtMs) {
          task.displayStartedAtMs = task.durationMs ? Date.now() - task.durationMs : Date.now();
        }
        task.imageUrls = job.imageUrls || task.imageUrls || [];
        task.sourcePreviewUrls = job.sourcePreviewUrls || task.sourcePreviewUrls || [];
        task.sourceFileNames = job.sourceFileNames || task.sourceFileNames || [];
        task.sourceDimensions = job.sourceDimensions || task.sourceDimensions || [];
        task.outputDimensions = job.outputDimensions || task.outputDimensions || [];
        task.requestedQuality = job.upstreamMeta?.requested_quality || task.requestedQuality || task.quality;
        task.actualQuality = job.upstreamMeta?.actual_quality || task.actualQuality || '';
        task.actualSize = job.upstreamMeta?.actual_size || task.actualSize || '';
        task.billingOutputTokens = job.upstreamMeta?.billing_output_tokens || task.billingOutputTokens || 0;
        task.error = formatTaskError(job.error || '');
        task.historyId = job.historyId || task.historyId || '';
        if (task.historyId) task.index = task.historyId;
        task.provider = job.provider || task.provider || '';
        task.fallbackReason = job.fallbackReason || task.fallbackReason || '';
        task.saved = Boolean(task.historyId);
        updateNavPoints(job.remainingPoints);
        updateStats();
        const canPatchRunningCard = previousStatus === 'running'
          && job.status === 'running'
          && previousImageCount === (task.imageUrls || []).length
          && previousSourceSignature === (task.sourcePreviewUrls || []).join('|')
          && previousError === task.error;
        if (canPatchRunningCard) {
          updateRunningTaskDuration(task);
        } else {
          updateTaskCard(task);
        }
        if (job.status === 'done') {
          if (resolve) resolve({ job });
          return;
        }
        if (job.status === 'failed') {
          const err = new Error(job.error || '任务失败');
          if (reject) reject(err);
          return;
        }
        setTimeout(() => pollServerJob(task, resolve, reject), 1500);
      } catch (err) {
        if (reject) reject(err);
      }
    }

    async function handleMissingServerJob(task, resolve, reject) {
      task.status = 'running';
      task.error = '服务刚刚重启，正在从历史记录找回结果...';
      updateTaskCard(task);
      try {
        const jobsRes = await fetch('/api/xi-image/jobs', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const jobsData = await jobsRes.json().catch(() => ({}));
        const recoveredJob = (jobsData.jobs || []).find((job) => {
          if (task.historyId && job.historyId && String(job.historyId) === String(task.historyId)) return true;
          return job.prompt === task.prompt
            && job.size === task.size
            && job.mode === task.mode;
        });
        if (recoveredJob) {
          task.jobId = recoveredJob.id;
          task.historyId = recoveredJob.historyId || task.historyId || '';
          task.status = recoveredJob.status || 'running';
          task.error = '';
          task.startedAtMs = recoveredJob.startedAtMs || task.startedAtMs;
          const submittedAtMs = parseServerJobSubmittedAtMs(recoveredJob);
          task.createdAtMs = submittedAtMs || task.createdAtMs || 0;
          task.submittedAtMs = submittedAtMs || task.submittedAtMs || task.createdAtMs || 0;
          task.durationMs = recoveredJob.durationMs || task.durationMs || 0;
          updateTaskCard(task);
          pollServerJob(task, resolve, reject);
          return;
        }
        await loadSavedTasks({ force: true });
        const candidates = state.tasks.filter((item) => {
          if (item.id === task.id || item.jobId === task.jobId) return false;
          const sameTask = item.status === 'done'
            && item.prompt === task.prompt
            && item.size === task.size
            && item.mode === task.mode;
          if (!sameTask) return false;
          const itemTime = Number(item.createdAtMs || 0);
          const taskTime = Number(task.createdAtMs || 0);
          return !itemTime || !taskTime || Math.abs(itemTime - taskTime) < 15 * 60 * 1000;
        });
        candidates.sort((a, b) => Number(b.createdAtMs || b.finishedAtMs || 0) - Number(a.createdAtMs || a.finishedAtMs || 0));
        const recovered = candidates[0];
        if (recovered) {
          Object.assign(task, {
            status: 'done',
            imageUrls: recovered.imageUrls || [],
            outputDimensions: recovered.outputDimensions || [],
            requestedQuality: recovered.requestedQuality || task.requestedQuality || task.quality,
            actualQuality: recovered.actualQuality || task.actualQuality || '',
            actualSize: recovered.actualSize || task.actualSize || '',
            billingOutputTokens: recovered.billingOutputTokens || task.billingOutputTokens || 0,
            sourceDimensions: recovered.sourceDimensions || [],
            historyId: recovered.historyId || task.historyId || '',
            saved: true,
            error: '',
            finishedAtMs: recovered.finishedAtMs || Date.now(),
            durationMs: recovered.durationMs || task.durationMs || 0
          });
          updateTaskCard(task);
          updateStats();
          if (resolve) resolve({ job: task });
          return;
        }
      } catch {}
      const err = new Error('服务重启后任务状态丢失，未在历史记录里找到结果。请重新生成一次。');
      if (reject) reject(err);
    }

    async function requestJson(url, body) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          handleAuthExpired(data.error || '登录已过期，请重新登录。');
        }
        const detail = data.detail ? '：' + data.detail : '';
        throw new Error((data.error || '这次没生成成功') + detail);
      }
      return data;
    }
