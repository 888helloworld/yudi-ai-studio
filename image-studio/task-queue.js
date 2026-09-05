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
          id: ImageStudio.createTaskId(),
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
      // 保留描述、参考图和尺寸，方便提交失败后继续修改。
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
        task.status = err?.uncertain || /fetch|network|网络|连接|JSON/i.test(err?.message || '') ? 'unknown' : 'failed';
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
      if (task.jobId) return waitServerJob(task);
      const submitResult = task.mode !== 'edit'
        ? await requestJson('/api/xi-image/jobs/generate', {
          prompt: task.prompt,
          size: task.size,
          count: task.count,
          quality: task.quality,
          clientTaskId: task.id,
          clientRequestId: task.id
        })
        : await submitEditJob(task);

      const job = submitResult.job;
      updateNavPoints(job.remainingPoints);
      task.jobId = job.id;
      task.costPoints = job.costPoints;
      task.refundedPoints = job.refundedPoints;
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
      form.append('clientTaskId', task.id);
      form.append('clientRequestId', task.id);
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
        task.pollErrorCount = 0;
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
        task.costPoints = job.costPoints;
        task.refundedPoints = job.refundedPoints;
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
        task.pollErrorCount = Number(task.pollErrorCount || 0) + 1;
        const message = String(err?.message || '').toLowerCase();
        const transient = message.includes('failed to fetch')
          || message.includes('fetch failed')
          || message.includes('network')
          || message.includes('timeout')
          || message.includes('连接');
        if (transient && task.pollErrorCount <= 5) {
          setStatus(`#${task.index} 网络有波动，正在继续确认任务状态（${task.pollErrorCount}/5）…`, '');
          setTimeout(() => pollServerJob(task, resolve, reject), 2000);
          return;
        }
        err.uncertain = true;
        task.status = 'unknown';
        task.error = '暂时无法确认结果，服务器可能仍在生成。请继续确认，不要新建重复任务。';
        updateTaskCard(task);
        if (reject) reject(err);
      }
    }

    async function handleMissingServerJob(task, resolve, reject) {
      try {
        const response = await fetch('/api/xi-image/jobs', { headers: { Authorization: 'Bearer ' + token } });
        if (!response.ok) throw new Error('任务状态暂不可用');
        const data = await response.json();
        const recovered = (data.jobs || []).find(job =>
          (task.historyId && String(job.historyId) === String(task.historyId)) ||
          (job.clientTaskId && job.clientTaskId === (task.clientTaskId || task.id)));
        if (recovered) { task.jobId = recovered.id; return pollServerJob(task, resolve, reject); }
        if (task.historyId) {
          const historyResponse = await fetch('/api/user/history/' + encodeURIComponent(task.historyId), { headers: { Authorization: 'Bearer ' + token } });
          if (historyResponse.ok) {
            const { history } = await historyResponse.json();
            const meta = parseJson(history.content) || {};
            const urls = parseSavedImageUrls(history.image_url);
            if (meta.status === 'failed' || urls.length) {
              Object.assign(task, {status: urls.length ? 'done' : 'failed',imageUrls: urls,
                refundedPoints:Number(meta.refunded_points || 0),costPoints:Number(history.cost_points || 0)+Number(meta.refunded_points || 0),
                outputDimensions:meta.output_dimensions || [],error:meta.error || '',saved:true});
              updateTaskCard(task); updateStats();
              if (task.status === 'done') { if (resolve) resolve({job:task}); }
              else if (reject) reject(new Error(task.error || '任务失败'));
              return;
            }
          }
        }
      } catch {}
      task.status = 'unknown'; task.error = '暂时无法确认结果，请稍后继续确认或到帮助中心反馈。';
      updateTaskCard(task);
      if (reject) reject(Object.assign(new Error(task.error), {uncertain:true}));
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
