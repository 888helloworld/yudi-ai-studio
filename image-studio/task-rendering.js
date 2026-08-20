    function renderTask(task) {
      const card = document.createElement('article');
      card.className = 'task-card xi-task-card';
      card.id = task.id;
      card.innerHTML = `
        <div class="task-body"></div>
      `;
      taskListEl.appendChild(card);
      updateTaskCard(task);
    }

    function renderTaskPage() {
      orderTasksForDisplay();
      taskListEl.innerHTML = '';
      const total = state.tasks.length;
      const totalPages = getTaskTotalPages();
      state.taskPage = Math.min(Math.max(state.taskPage, 1), totalPages);

      emptyEl.style.display = taskHistoryLoaded && total === 0 ? 'flex' : 'none';
      taskPagerEl.style.display = total > 0 ? 'flex' : 'none';
      if (total === 0) {
        taskPageInfoEl.textContent = '第 0 / 0 页';
        taskPrevPageBtn.disabled = true;
        taskNextPageBtn.disabled = true;
        return;
      }

      const start = (state.taskPage - 1) * state.taskPageSize;
      const pageTasks = state.tasks.slice(start, start + state.taskPageSize);
      pageTasks.forEach(renderTask);
      taskPageInfoEl.textContent = `第 ${state.taskPage} / ${totalPages} 页 · 共 ${total} 条`;
      taskPrevPageBtn.disabled = state.taskPage <= 1;
      taskNextPageBtn.disabled = state.taskPage >= totalPages;
    }

    function orderTasksForDisplay() {
      const submittedTimeValue = (task) => Number(task.submittedAtMs || task.createdAtMs || 0);
      const sequenceValue = (task) => Number(task.historyId || task.index || 0);
      state.tasks.sort((a, b) => {
        const submittedDiff = submittedTimeValue(b) - submittedTimeValue(a);
        if (submittedDiff !== 0) return submittedDiff;
        return sequenceValue(b) - sequenceValue(a);
      });
    }

    function getTaskTotalPages() {
      const loadedPages = Math.ceil(state.tasks.length / state.taskPageSize);
      const hasMoreHistory = state.historyPage < state.historyTotalPages;
      return Math.max(1, loadedPages + (hasMoreHistory ? 1 : 0));
    }

    function updateTaskCard(task) {
      const card = document.getElementById(task.id);
      if (!card) return;
      const body = card.querySelector('.task-body');

      body.innerHTML = '';
      const infoBlock = createTaskInfoBlock(task);
      if (task.status !== 'done') body.appendChild(infoBlock);

      if (task.status === 'queued') {
        appendTaskSourceThumbs(body, task);
        body.appendChild(createPlainLine('排队等出图'));
      } else if (task.status === 'running') {
        appendTaskSourceThumbs(body, task);
        body.appendChild(createDurationLine(task));
        const loading = document.createElement('div');
        loading.className = 'task-loading';
        loading.innerHTML = `<div class="spinner"></div><span>${task.detailSuite ? '正在生成详情图' : `正在${task.mode === 'edit' ? '参考改图' : '生成图片'}`}...</span>`;
        body.appendChild(loading);
      } else if (task.status === 'failed') {
        appendTaskSourceThumbs(body, task);
        body.appendChild(createDurationLine(task));
        const error = document.createElement('div');
        error.className = 'task-error';
        error.textContent = formatTaskError(task.error || '生成失败');
        body.appendChild(error);
        const actions = document.createElement('div');
        actions.className = 'task-actions';
        const retry = document.createElement('button');
        retry.className = 'task-btn';
        retry.type = 'button';
        retry.textContent = '重试';
        retry.addEventListener('click', () => retryTask(task.id));
        actions.appendChild(retry);
        body.appendChild(actions);
      } else if (task.status === 'done') {
        body.appendChild(createImageGrid(task));
        body.appendChild(infoBlock);
        appendTaskSourceThumbs(body, task);
      }
      updatePromptToggleVisibility(card);
    }

    function appendTaskSourceThumbs(target, task) {
      if (task.mode !== 'edit') return;
      if ((task.sourcePreviewUrls || []).length === 0 && (task.sourceFileNames || []).length === 0) return;
      target.appendChild(createSourceThumbStrip(task));
    }

    function createTaskInfoBlock(task) {
      const fragment = document.createDocumentFragment();
      const statusMap = {
        queued: '等待中',
        running: '出图中',
        done: '完成',
        failed: '失败'
      };
      if (task.status !== 'done') {
        const stateLine = document.createElement('div');
        stateLine.className = 'xi-task-state';
        const badge = document.createElement('span');
        badge.className = 'task-type';
        badge.textContent = statusMap[task.status] || task.status;
        stateLine.appendChild(badge);
        fragment.appendChild(stateLine);
      }

      if (task.detailSuite) {
        const detail = document.createElement('div');
        detail.className = 'detail-task-kicker';
        detail.innerHTML = `<strong>电商详情套图</strong><span>${String(task.detailSuite.moduleIndex).padStart(2, '0')}/${task.detailSuite.total} ${escapeHtml(task.detailSuite.moduleTitle)} · ${escapeHtml(task.detailSuite.productName)}</span>`;
        fragment.appendChild(detail);
      }
      const prompt = document.createElement('div');
      prompt.className = 'xi-task-prompt';
      prompt.textContent = task.prompt;
      fragment.appendChild(prompt);

      const promptTools = document.createElement('div');
      promptTools.className = 'xi-prompt-tools';
      const refillPrompt = document.createElement('button');
      refillPrompt.className = 'xi-small-btn';
      refillPrompt.type = 'button';
      refillPrompt.textContent = '提示词重新生图';
      refillPrompt.addEventListener('click', () => refillPromptFromTask(task));
      promptTools.appendChild(refillPrompt);
      if ((task.prompt || '').trim()) {
        const toggle = document.createElement('button');
        toggle.className = 'prompt-toggle hidden';
        toggle.type = 'button';
        toggle.textContent = '查看完整提示词';
        toggle.addEventListener('click', () => {
          const expanded = prompt.classList.toggle('expanded');
          toggle.textContent = expanded ? '收起提示词' : '查看完整提示词';
        });
        promptTools.appendChild(toggle);
      }
      fragment.appendChild(promptTools);

      const meta = document.createElement('div');
      meta.className = 'xi-task-meta';
      const actualSize = getFirstDimensionSize(task.outputDimensions);
      const displaySize = getDisplayImageSize(task.size, task.outputDimensions);
      meta.textContent = [
        `#${task.index}`,
        task.status === 'done' ? `完成 ${getTaskDurationText(task)}` : '',
        getLabeledImageSize(displaySize),
        actualSize && actualSize !== displaySize ? `实际${actualSize}` : '',
        task.detailSuite ? task.detailSuite.moduleTitle : '',
        Number(task.count) > 1 ? `${task.count} 张` : '',
        task.createdAt
      ].filter(Boolean).join(' · ');
      fragment.appendChild(meta);
      return fragment;
    }

    function updatePromptToggleVisibility(card) {
      const prompt = card?.querySelector('.xi-task-prompt');
      const toggle = card?.querySelector('.prompt-toggle');
      if (!prompt || !toggle || prompt.classList.contains('expanded')) return;
      requestAnimationFrame(() => {
        const isOverflowing = prompt.scrollHeight > prompt.clientHeight + 1 || prompt.scrollWidth > prompt.clientWidth + 1;
        toggle.classList.toggle('hidden', !isOverflowing);
      });
    }

    function refillPromptFromTask(task) {
      if (!(task.prompt || '').trim()) {
        setStatus('这条记录没有可回填的提示词。', 'error');
        return;
      }
      promptEl.value = task.prompt || '';
      state.selectedSize = SUPPORTED_IMAGE_SIZES.includes(task.size) ? task.size : state.selectedSize;
      state.quality = DEFAULT_QUALITY;
      countEl.value = 1;
      batchCountEl.value = DEFAULT_BATCH_COUNT;
      updateBatchCountButtons();
      sourceSlots.forEach((_, index) => clearSourceImage(index, { silent: true }));
      document.querySelectorAll('#sizeSelector .ratio-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.size === state.selectedSize);
      });
      updateGenerateButton();
      updateEstimate();
      promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      promptEl.focus();
      setStatus('已把提示词回填到图片描述。', 'ok');
    }

    function createDurationLine(task) {
      const line = document.createElement('div');
      line.className = 'xi-duration';
      const label = task.status === 'running' ? '已用时' : '生成用时';
      line.innerHTML = `<span>${label}</span><strong data-role="task-duration">${getTaskDurationText(task)}</strong>`;
      return line;
    }

    function updateRunningTaskDuration(task) {
      const card = document.getElementById(task.id);
      const duration = card?.querySelector('[data-role="task-duration"]');
      if (duration) duration.textContent = getTaskDurationText(task);
    }

    function formatTaskError(message) {
      const text = String(message || '').trim();
      if (!text) return '';
      const lower = text.toLowerCase();
      if (text.includes('系统已跳过这张')) {
        return '图片服务连接中断，请稍后重试。本次没有生成图片，积分已退回。';
      }
      if (lower.includes('terminated') || lower.includes('socket hang up') || lower.includes('other side closed') || lower.includes('body timeout') || lower.includes('response body')) {
        return '图片服务连接中断，请稍后重试。本次没有生成图片，积分已退回。';
      }
      if (lower.includes('failed to fetch')) {
        return '本地服务连接中断，可能是服务刚重启或网络请求被浏览器取消。请刷新页面后重试。';
      }
      if (lower.includes('fetch failed') || lower.includes('connect timeout') || lower.includes('und_err_connect_timeout')) {
        return '图片服务连接失败，请稍后重试。本次没有生成图片，积分已退回。';
      }
      return text;
    }

    function getTaskDurationText(task) {
      if (task.status !== 'running' && task.durationMs) return formatDurationMs(task.durationMs);
      const startMs = task.status === 'running' ? (task.displayStartedAtMs || task.startedAtMs) : task.startedAtMs;
      return startMs ? formatDurationMs((task.finishedAtMs || Date.now()) - startMs) : '历史记录';
    }

    function createSourceThumbStrip(task) {
      const source = document.createElement('div');
      source.className = 'xi-source-thumb';
      const urls = (task.sourcePreviewUrls || [])
        .filter((url) => isRenderableSourceUrl(url, task))
        .slice(0, 3);
      const names = (task.sourceFileNames || []).filter(Boolean).slice(0, 3);
      const total = Math.max(urls.length, names.length);

      const header = document.createElement('div');
      header.className = 'xi-source-thumb-header';
      const title = document.createElement('span');
      title.textContent = `参考图 · ${total || 0} 张`;
      const actions = document.createElement('div');
      actions.className = 'xi-source-thumb-actions';
      const refill = document.createElement('button');
      refill.className = 'xi-small-btn';
      refill.type = 'button';
      refill.textContent = '提示词+参考图 重新生图';
      refill.addEventListener('click', () => refillComposerFromTask(task, refill));
      actions.appendChild(refill);
      const nav = document.createElement('div');
      nav.className = 'xi-source-thumb-nav';
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.textContent = '‹';
      prev.setAttribute('aria-label', '向左查看参考图');
      const next = document.createElement('button');
      next.type = 'button';
      next.textContent = '›';
      next.setAttribute('aria-label', '向右查看参考图');
      nav.append(prev, next);
      actions.appendChild(nav);
      header.append(title, actions);

      const scroller = document.createElement('div');
      scroller.className = 'xi-source-scroll';
      if (urls.length > 0) {
        urls.forEach((url, index) => {
          const img = document.createElement('img');
          setProtectedImageSource(img, getThumbnailImageUrl(url), `参考图 ${index + 1}`);
          img.title = names[index] || `参考图 ${index + 1}`;
          img.addEventListener('click', () => {
            openStandaloneImagePreview(url, names[index] || `任务 #${task.index} · 参考图 ${index + 1}`, `xi_source_${task.index}_${index + 1}.png`);
          });
          img.addEventListener('error', () => {
            img.replaceWith(createSourceNameChip(names[index] || `参考图 ${index + 1}`));
          }, { once: true });
          scroller.appendChild(img);
        });
      } else {
        names.forEach((name) => {
          scroller.appendChild(createSourceNameChip(name));
        });
      }

      prev.addEventListener('click', () => scroller.scrollBy({ left: -140, behavior: 'smooth' }));
      next.addEventListener('click', () => scroller.scrollBy({ left: 140, behavior: 'smooth' }));
      if (total <= 3) nav.style.display = 'none';

      source.append(header, scroller);
      return source;
    }

    async function refillComposerFromTask(task, button) {
      const urls = (task.sourcePreviewUrls || [])
        .filter((url) => isRenderableSourceUrl(url, task))
        .slice(0, 3);
      if (!task.prompt && urls.length === 0) {
        setStatus('这条记录没有可回填的提示词或参考图。', 'error');
        return;
      }

      const originalText = button?.textContent || '提示词+参考图 重新生图';
      if (button) {
        button.disabled = true;
        button.textContent = '回填中...';
      }
      try {
        promptEl.value = task.prompt || '';
        state.selectedSize = SUPPORTED_IMAGE_SIZES.includes(task.size) ? task.size : DEFAULT_SIZE;
        state.quality = DEFAULT_QUALITY;
        countEl.value = 1;
        batchCountEl.value = DEFAULT_BATCH_COUNT;
        updateBatchCountButtons();
        document.querySelectorAll('#sizeSelector .ratio-btn').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.size === state.selectedSize);
        });
        sourceSlots.forEach((_, index) => clearSourceImage(index, { silent: true }));

        let loaded = 0;
        for (let index = 0; index < urls.length; index += 1) {
          const filename = task.sourceFileNames?.[index] || getSourceImageName(index);
          try {
            const file = await imageUrlToFile(urls[index], filename);
            await setSourceImage(index, file);
            loaded += 1;
          } catch {}
        }

        updateGenerateButton();
        updateEstimate();
        promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        promptEl.focus();
        const suffix = urls.length > 0 && loaded < urls.length ? `，${urls.length - loaded} 张参考图读取失败` : '';
        setStatus(`已回填提示词和 ${loaded} 张参考图，可以直接点开始改图${suffix}。`, loaded > 0 || urls.length === 0 ? 'ok' : 'error');
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = originalText;
        }
      }
    }

    async function removeTask(taskId) {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) return;
      const message = task.saved || task.historyId
        ? '确定删除这条生成记录吗？删除后刷新历史也不会再显示。'
        : task.status === 'queued'
          ? '这个任务还在排队，移除后不会继续生成，也找不回来。确定移除吗？'
          : task.status === 'running'
            ? '这个任务正在生成，移出当前列表后可能还会在后台继续跑。确定移出吗？'
            : '这条临时记录还没保存到历史，移除后找不回来。确定移除吗？';
      if (!window.confirm(message)) return;
      if (task.historyId) {
        try {
          const res = await fetch(`/api/user/history/${encodeURIComponent(task.historyId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            if (res.status === 401) {
              handleAuthExpired(data.error || '登录已过期，请重新登录。');
              return;
            }
            throw new Error(data.error || '删除历史记录失败');
          }
        } catch (err) {
          setStatus(err.message || '删除历史记录失败，请稍后再试。', 'error');
          return;
        }
      }
      if (task && task.status === 'queued') {
        state.queue = state.queue.filter((item) => item.id !== taskId);
      }
      state.tasks = state.tasks.filter((item) => item.id !== taskId);
      releaseTaskSourcePreviewUrls(task);
      renderTaskPage();
      updateStats();
      if (task.historyId) {
        setStatus('生成记录已删除，刷新历史也不会再显示。', 'ok');
      } else {
        setStatus('已移出当前列表。', 'ok');
      }
    }

    function retryTask(taskId) {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task || task.status === 'running' || task.status === 'queued') return;
      task.status = 'queued';
      task.error = '';
      task.imageUrls = [];
      task.startedAtMs = 0;
      task.displayStartedAtMs = 0;
      task.finishedAtMs = 0;
      state.queue.push(task);
      state.taskPage = 1;
      renderTaskPage();
      updateTaskCard(task);
      updateStats();
      setStatus(`#${task.index} 已重新生成。`, 'ok');
      processQueue();
    }

    function clearQueuedTasks() {
      const queuedIds = new Set(state.queue.map((task) => task.id));
      state.tasks.forEach((task) => {
        if (queuedIds.has(task.id)) releaseTaskSourcePreviewUrls(task);
      });
      state.queue = [];
      state.tasks = state.tasks.filter((task) => {
        if (!queuedIds.has(task.id)) return true;
        return false;
      });
      renderTaskPage();
      updateStats();
      setStatus('已取消等待中的内容，正在生成的会继续完成。', 'ok');
    }
