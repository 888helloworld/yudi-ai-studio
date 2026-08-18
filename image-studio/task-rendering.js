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
      if (text.includes('豆包备用通道已关闭') || text.includes('本次未使用豆包生成')) {
        return '图片服务连接失败，请稍后重试。本次没有生成图片，积分已退回。';
      }
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

    function isRenderableSourceUrl(url, task) {
      if (!url) return false;
      if (String(url).startsWith('blob:')) return !task.saved;
      return true;
    }

    function createSourceNameChip(name) {
      const chip = document.createElement('div');
      chip.className = 'xi-source-name-chip';
      chip.textContent = name || '参考图';
      return chip;
    }

    function getFirstDimensionSize(dimensions) {
      const first = Array.isArray(dimensions) ? dimensions.find(Boolean) : dimensions;
      if (!first) return '';
      if (typeof first === 'string') return first;
      if (first.size) return String(first.size);
      if (first.width && first.height) return `${first.width}x${first.height}`;
      return '';
    }

    function getDisplayImageSize(size, outputDimensions) {
      return getFirstDimensionSize(outputDimensions) || DISPLAY_IMAGE_SIZES[size] || size || '';
    }

    function parseImageSizeText(size) {
      const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(size || '').trim());
      if (!match) return null;
      return { width: Number(match[1]), height: Number(match[2]) };
    }

    function getImageOrientationLabel(size) {
      const parsed = parseImageSizeText(size);
      if (!parsed || !parsed.width || !parsed.height) return '';
      if (parsed.width === parsed.height) return '方图';
      return parsed.width > parsed.height ? '横图' : '竖图';
    }

    function getLabeledImageSize(size) {
      const label = getImageOrientationLabel(size);
      return [label, size].filter(Boolean).join(' ');
    }

    function createImageGrid(task) {
      const grid = document.createElement('div');
      grid.className = 'xi-image-grid';
      task.imageUrls.forEach((url, index) => {
        const item = document.createElement('div');
        item.className = 'xi-image-card';
        const img = document.createElement('img');
        setProtectedImageSource(img, getThumbnailImageUrl(url), `任务 ${task.index} 图片 ${index + 1}`);
        img.addEventListener('click', () => openImagePreview(url, task, index));
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.download = buildImageDownloadName(task, index);
        link.textContent = '下载';
        link.addEventListener('click', (event) => {
          event.preventDefault();
          downloadImageFile(url, link.download);
        });
        item.append(img, link);
        grid.appendChild(item);
      });
      return grid;
    }

    function setPreviewImageSource(url, altText = '') {
      const requestId = ++previewRequestSeq;
      previewImage.removeAttribute('src');
      previewImage.alt = '';
      previewImage.classList.remove('preview-image-ready', 'preview-image-failed');
      previewImage.classList.add('preview-image-loading');
      previewImage.setAttribute('aria-busy', 'true');
      previewImage.loading = 'eager';
      previewLoading?.classList.add('show');

      const markFailed = () => {
        if (requestId !== previewRequestSeq) return;
        previewImage.classList.remove('preview-image-loading', 'preview-image-ready');
        previewImage.classList.add('preview-image-failed');
        previewImage.removeAttribute('aria-busy');
        previewImage.alt = '';
        previewLoading?.classList.remove('show');
      };

      const markReady = () => {
        if (requestId !== previewRequestSeq) return;
        previewImage.classList.remove('preview-image-loading', 'preview-image-failed');
        previewImage.classList.add('preview-image-ready');
        previewImage.removeAttribute('aria-busy');
        previewImage.alt = altText || '图片预览';
        previewLoading?.classList.remove('show');
      };

      getDisplayImageUrl(url)
        .then((displayUrl) => {
          if (requestId !== previewRequestSeq) return;
          previewImage.onload = markReady;
          previewImage.onerror = markFailed;
          previewImage.src = displayUrl;
          if (previewImage.complete && previewImage.naturalWidth > 0) markReady();
        })
        .catch(markFailed);
    }

    async function downloadImageFile(url, filename) {
      const safeName = filename || 'xi_xu_image.png';
      try {
        const blob = await fetchAssetBlob(url);
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = safeName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      } catch (err) {
        setStatus('浏览器下载失败，请重新登录后再试。', 'error');
      }
    }

    async function openImageInNewTab(url) {
      try {
        const blob = await fetchAssetBlob(url);
        const objectUrl = URL.createObjectURL(blob);
        window.open(objectUrl, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
      } catch {
        setStatus('原图打开失败，请重新登录后再试。', 'error');
      }
    }

    function openImagePreview(url, task, index) {
      const filename = buildImageDownloadName(task, index);
      currentPreviewImage = { url, filename, title: '' };
      setPreviewImageSource(url, '图片预览');
      previewTitle.textContent = '';
      previewDownload.href = url;
      previewDownload.download = filename;
      previewOpen.href = '#';
      previewOverlay.classList.add('show');
      previewOverlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    function buildImageDownloadName(task, imageIndex = 0) {
      const displaySize = getDisplayImageSize(task.size, task.outputDimensions);
      const sizeLabel = getLabeledImageSize(displaySize).replace(/\s+/g, '-');
      const dateLabel = formatDownloadDate(task.createdAt || task.doneAt || '');
      const imageLabel = `第${imageIndex + 1}张`;
      const parts = task.detailSuite
        ? [
          '御弟哥哥',
          '详情套图',
          task.detailSuite.productName,
          `${String(task.detailSuite.moduleIndex).padStart(2, '0')}-${task.detailSuite.moduleTitle}`,
          sizeLabel,
          imageLabel,
          dateLabel
        ]
        : [
          '御弟哥哥',
          'gpt-image2',
          task.index ? `#${task.index}` : '',
          task.mode === 'edit' ? '参考改图' : '文生图',
          sizeLabel,
          imageLabel,
          dateLabel
        ];
      return sanitizeDownloadFilename(parts.filter(Boolean).join('-')) + '.png';
    }

    function formatDownloadDate(value) {
      const text = String(value || '').trim();
      const match = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(text);
      if (match) return `${match[1]}-${match[2]}-${match[3]}-${match[4]}-${match[5]}`;
      return text.replace(/[年月日时分秒/:]+/g, '-').replace(/\s+/g, '-');
    }

    function sanitizeDownloadFilename(name) {
      return String(name || '御弟哥哥 · gpt-image-2 生图')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .slice(0, 180);
    }

    function openStandaloneImagePreview(url, title = '图片预览', filename = 'preview.png') {
      currentPreviewImage = { url, filename, title };
      setPreviewImageSource(url, title);
      previewTitle.textContent = title;
      previewDownload.href = url;
      previewDownload.download = filename;
      previewOpen.href = '#';
      previewOverlay.classList.add('show');
      previewOverlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    function closeImagePreview() {
      previewRequestSeq += 1;
      if (previewOverlay.contains(document.activeElement)) document.activeElement.blur();
      previewOverlay.classList.remove('show');
      previewOverlay.setAttribute('aria-hidden', 'true');
      delete previewImage.dataset.sourceUrl;
      previewImage.removeAttribute('src');
      previewImage.classList.remove('preview-image-ready', 'preview-image-loading', 'preview-image-failed');
      previewImage.removeAttribute('aria-busy');
      previewLoading?.classList.remove('show');
      currentPreviewImage = null;
      document.body.style.overflow = '';
    }

    async function usePreviewImageAsSource() {
      if (!currentPreviewImage?.url) {
        setStatus('没有可用于改图的图片。', 'error');
        return;
      }
      const targetIndex = state.sourceFiles.findIndex((file) => !file);
      if (targetIndex === -1) {
        setStatus('参考图已经放满 4 张，请先清掉一张再添加。', 'error');
        closeImagePreview();
        return;
      }

      previewEditBtn.disabled = true;
      previewEditBtn.textContent = '正在放入参考图...';
      try {
        const file = await imageUrlToFile(currentPreviewImage.url, currentPreviewImage.filename || 'preview.png');
        closeImagePreview();
        await setSourceImage(targetIndex, file);
        promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        promptEl.focus();
        setStatus(`已把图片放到参考图 ${targetIndex + 1}，写下想修改的地方就可以改图。`, 'ok');
      } catch (err) {
        setStatus(err?.message || '图片放入参考图失败，请下载后手动上传。', 'error');
      } finally {
        previewEditBtn.disabled = false;
        previewEditBtn.textContent = '用这张改图';
      }
    }

    async function imageUrlToFile(url, filename) {
      const blob = await fetchAssetBlob(url);
      if (!blob.type.startsWith('image/')) throw new Error('当前文件不是图片，不能用于改图。');
      return new File([blob], filename || 'preview.png', { type: blob.type || 'image/png' });
    }

    function resolveAssetUrl(url) {
      if (!url) return '';
      if (String(url).startsWith('data:') || String(url).startsWith('blob:')) return url;
      return new URL(url, window.location.origin).href;
    }

    function openPromptPreview(data) {
      promptPreviewBody.innerHTML = '';
      promptPreviewTitle.textContent = data?.result?.title || 'Prompt 结果';
      addReverseBlock('中文 Prompt', data?.result?.polished_prompt_zh || data?.result?.universal_prompt_zh || data?.result?.faithful_prompt_zh || '', true, promptPreviewBody);
      addReverseBlock('英文 Prompt', data?.result?.polished_prompt_en || data?.result?.universal_prompt_en || data?.result?.dalle_prompt || data?.result?.midjourney_prompt || data?.raw || '', true, promptPreviewBody);
      promptPreviewOverlay.classList.add('show');
      promptPreviewOverlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    function closePromptPreview() {
      promptPreviewOverlay.classList.remove('show');
      promptPreviewOverlay.setAttribute('aria-hidden', 'true');
      promptPreviewBody.innerHTML = '';
      document.body.style.overflow = '';
    }

    function createPlainLine(text) {
      const line = document.createElement('div');
      line.className = 'task-meta';
      line.textContent = text;
      return line;
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

