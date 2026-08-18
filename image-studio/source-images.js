    function updateStats() {
      const queued = state.tasks.filter((task) => task.status === 'queued').length;
      const running = state.tasks.filter((task) => task.status === 'running').length;
      const done = state.tasks.filter((task) => task.status === 'done').length;
      const failed = state.tasks.filter((task) => task.status === 'failed').length;
      const total = state.tasks.length;
      const images = state.tasks.reduce((sum, task) => sum + (task.imageUrls?.length || 0), 0);
      const totalPages = getTaskTotalPages();
      state.taskPage = Math.min(Math.max(state.taskPage, 1), totalPages);
      const setStat = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
      };
      setStat('statQueued', queued);
      setStat('statRunning', running);
      setStat('statDone', done);
      setStat('statTotal', total);
      setStat('statImages', images);
      setStat('statFailed', failed);
      setStat('statConcurrency', getParallelism());
      if (state.tasks.length > 0) {
        taskPageInfoEl.textContent = `第 ${state.taskPage} / ${totalPages} 页 · 共 ${state.tasks.length} 条`;
        taskPrevPageBtn.disabled = state.taskPage <= 1;
        taskNextPageBtn.disabled = state.taskPage >= totalPages;
      }
    }

    function updateEstimate() {
      const count = 1;
      const batchCount = clamp(Number(batchCountEl.value || 1), 1, MAX_BATCH_COUNT);
      const parallelism = getParallelism();
      const totalImages = count * batchCount;
      if (estimateTotalEl) estimateTotalEl.textContent = `这次生成 ${totalImages} 张图 · 同时生成 ${parallelism} 张`;
    }

    function updateBatchCountButtons() {
      const value = String(clamp(Number(batchCountEl.value || 1), 1, MAX_BATCH_COUNT));
      batchCountEl.value = value;
      document.querySelectorAll('#batchCountPicker .count-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.count === value);
      });
    }

    async function setSourceImage(index, file) {
      if (!file.type.startsWith('image/')) {
        setStatus('只能上传图片文件。', 'error');
        return;
      }
      if (file.size > MAX_SOURCE_INPUT_BYTES) {
        setStatus('原图不能超过 50MB，请先缩小后再上传。', 'error');
        return;
      }

      const slot = sourceSlots[index];
      const hint = slot.querySelector('.drop-hint');
      const preview = slot.querySelector('.xi-source-preview');
      setStatus(
        file.size > MAX_SOURCE_IMAGE_BYTES
          ? `原图超过 20MB，正在温和压缩参考图 ${index + 1}...`
          : `正在准备参考图 ${index + 1}...`,
        ''
      );
      generateBtn.disabled = true;
      let preparedFile;
      try {
        preparedFile = await prepareSourceImage(file);
      } catch (err) {
        generateBtn.disabled = false;
        setStatus(err.message || '图片格式处理失败，请换一张 PNG/JPG/WebP 图片。', 'error');
        return;
      }

      if (state.sourcePreviewUrls[index]) URL.revokeObjectURL(state.sourcePreviewUrls[index]);
      state.sourceFiles[index] = preparedFile;
      state.sourcePreviewUrls[index] = URL.createObjectURL(preparedFile);
      renderSourceSlot(index);
      generateBtn.disabled = false;
      updateGenerateButton();
      setStatus(`已放入 ${getSelectedSourceImages().length} 张参考图，可以开始改图了。`, 'ok');
    }

    function renderSourceSlot(index) {
      const slot = sourceSlots[index];
      const input = slot.querySelector('.source-image-input');
      const hint = slot.querySelector('.drop-hint');
      const preview = slot.querySelector('.xi-source-preview');
      const file = state.sourceFiles[index];
      const previewUrl = state.sourcePreviewUrls[index];
      input.value = '';
      preview.innerHTML = '';
      slot.classList.toggle('has-source', Boolean(file && previewUrl));
      hint.style.display = file && previewUrl ? 'none' : 'flex';
      if (!file || !previewUrl) return;

      const img = document.createElement('img');
      img.src = previewUrl;
      img.alt = `原图 ${index + 1} 预览`;
      img.title = '点击放大参考图，拖动可换位置';
      img.draggable = true;
      img.addEventListener('dragstart', (event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/x-source-index', String(index));
        event.dataTransfer.setData('text/plain', String(index));
        slot.classList.add('dragging');
      });
      img.addEventListener('dragend', () => {
        sourceSlots.forEach((item) => item.classList.remove('dragging', 'drag-over'));
      });
      img.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openStandaloneImagePreview(previewUrl, `参考图 ${index + 1}`, getSourceImageName(index));
      });

      const name = document.createElement('div');
      name.className = 'xi-source-name';
      name.textContent = getSourceImageName(index);
      const remove = document.createElement('button');
      remove.className = 'remove-ref';
      remove.type = 'button';
      remove.textContent = '×';
      remove.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearSourceImage(index);
      });

      preview.append(img, name, remove);
    }

    function getDraggedSourceIndex(event) {
      const raw = event.dataTransfer?.getData('text/x-source-index');
      if (raw === '') return null;
      const index = Number(raw);
      if (!Number.isInteger(index) || index < 0 || index >= state.sourceFiles.length) return null;
      return state.sourceFiles[index] ? index : null;
    }

    function moveSourceImage(fromIndex, toIndex) {
      if (fromIndex === toIndex) return;
      if (!state.sourceFiles[fromIndex]) return;
      [state.sourceFiles[fromIndex], state.sourceFiles[toIndex]] = [state.sourceFiles[toIndex], state.sourceFiles[fromIndex]];
      [state.sourcePreviewUrls[fromIndex], state.sourcePreviewUrls[toIndex]] = [state.sourcePreviewUrls[toIndex], state.sourcePreviewUrls[fromIndex]];
      renderSourceSlot(fromIndex);
      renderSourceSlot(toIndex);
      updateGenerateButton();
      setStatus(`已调整参考图顺序：图${fromIndex + 1} ↔ 图${toIndex + 1}。`, 'ok');
    }

    async function handleSourcePaste(event) {
      if (shouldIgnoreImagePaste(event.target)) return;
      const file = getImageFileFromClipboard(event.clipboardData);
      if (!file) return;

      const targetIndex = getPasteTargetSourceIndex(event.target);
      if (targetIndex < 0) {
        setStatus('参考图已经放满 4 张，请先清掉一张再粘贴。', 'error');
        return;
      }

      event.preventDefault();
      sourceGrid.classList.add('paste-ready');
      try {
        await setSourceImage(targetIndex, file);
        setStatus(`已粘贴到参考图 ${targetIndex + 1}，可以开始改图了。`, 'ok');
      } finally {
        setTimeout(() => sourceGrid.classList.remove('paste-ready'), 450);
      }
    }

    async function handleReversePaste(event) {
      if (!isReversePasteTarget(event.target)) return;
      const file = getImageFileFromClipboard(event.clipboardData, 'pasted_reverse');
      if (!file) return;

      event.preventDefault();
      reverseDropZone.classList.add('paste-ready');
      try {
        if (setReverseImage(file)) {
          setReverseStatus('已粘贴图片，可以加入识图。', 'ok');
        }
      } finally {
        setTimeout(() => reverseDropZone.classList.remove('paste-ready'), 450);
      }
    }

    function shouldIgnoreImagePaste(target) {
      if (pasteTargetMode === 'reverse') return true;
      const active = document.activeElement;
      if (active?.closest?.('#reversePrompt, .preview-overlay, .prompt-preview-overlay')) return true;
      if (!target) return false;
      const tagName = target.tagName;
      if (tagName === 'TEXTAREA') return false;
      if (tagName === 'INPUT' && target.type !== 'file') return false;
      return Boolean(target.closest?.('#reversePrompt, .preview-overlay, .prompt-preview-overlay'));
    }

    function isReversePasteTarget(target) {
      const active = document.activeElement;
      return Boolean(pasteTargetMode === 'reverse' || target?.closest?.('#reversePrompt') || active?.closest?.('#reversePrompt'));
    }

    function getImageFileFromClipboard(clipboardData, basename = 'pasted_source') {
      const items = Array.from(clipboardData?.items || []);
      const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
      const file = imageItem?.getAsFile();
      if (!file) return null;
      const ext = file.type === 'image/jpeg' ? 'jpg' : (file.type.split('/')[1] || 'png');
      const name = file.name || `${basename}_${Date.now()}.${ext}`;
      return new File([file], name, { type: file.type || 'image/png' });
    }

    function getPasteTargetSourceIndex(target) {
      const slot = target?.closest?.('[data-source-slot]');
      if (slot) {
        const index = Number(slot.dataset.sourceSlot || 0);
        if (!state.sourceFiles[index]) return index;
      }
      return getFirstEmptySourceIndex();
    }

    function getFirstEmptySourceIndex() {
      return state.sourceFiles.findIndex((file) => !file);
    }

    function clearSourceImage(index, options = {}) {
      state.sourceFiles[index] = null;
      if (state.sourcePreviewUrls[index]) URL.revokeObjectURL(state.sourcePreviewUrls[index]);
      state.sourcePreviewUrls[index] = '';
      renderSourceSlot(index);
      updateGenerateButton();
      const selectedCount = getSelectedSourceImages().length;
      if (!options.silent) {
        setStatus(selectedCount > 0 ? `还保留 ${selectedCount} 张参考图。` : '参考图已清空，现在是自由生图。', 'ok');
      }
    }

    function clearAllSourceImages() {
      if (getSelectedSourceImages().length === 0) {
        setStatus('现在没有参考图。', 'ok');
        return;
      }
      sourceSlots.forEach((_, index) => clearSourceImage(index, { silent: true }));
      updateGenerateButton();
      setStatus('参考图已清空，现在是自由生图。', 'ok');
    }

    function updateGenerateButton() {
      const span = generateBtn.querySelector('span');
      if (span) span.textContent = getSelectedSourceImages().length > 0 ? '开始改图' : '开始出图';
    }

    function getSelectedSourceImages() {
      return state.sourceFiles
        .map((file, index) => ({ file, previewUrl: state.sourcePreviewUrls[index], slotIndex: index }))
        .filter((source) => source.file);
    }

    function createTaskSourcePreviewUrls(sources) {
      return (sources || []).map((source) => URL.createObjectURL(source.file));
    }

    function releaseTaskSourcePreviewUrls(task) {
      (task?.localSourcePreviewUrls || []).forEach((url) => {
        if (String(url || '').startsWith('blob:')) URL.revokeObjectURL(url);
      });
      if (task) task.localSourcePreviewUrls = [];
    }

    function getSourceImageName(index) {
      return `图${index + 1}.png`;
    }

    async function prepareSourceImage(file) {
      const keepOriginal = file.size <= MAX_SOURCE_IMAGE_BYTES
        && file.type === 'image/png';
      if (keepOriginal) return file;

      if (file.size > MAX_SOURCE_INPUT_BYTES) {
        throw new Error('原图不能超过 50MB，请先缩小后再上传。');
      }

      const dataUrl = await readFileAsDataUrl(file);
      const image = await loadImage(dataUrl);
      const maxSides = [4096, 3072, 2560, 2048, 1792, 1536];

      for (const maxSide of maxSides) {
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const blob = await drawImageToBlob(image, width, height, 'image/png');
        if (blob && blob.size <= TARGET_PREPARED_SOURCE_BYTES) {
          return new File([blob], normalizePreparedImageName(file.name, 'png'), { type: 'image/png' });
        }
      }

      throw new Error('图片压缩后仍超过 20MB，请先缩小原图。');
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    }

    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('图片无法解码'));
        image.src = src;
      });
    }

    function drawImageToBlob(image, width, height, type) {
      return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('图片压缩失败'));
        }, type);
      });
    }

    function normalizePreparedImageName(name, extension) {
      const base = String(name || 'source').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'source';
      return `${base}.${extension}`;
    }

    function startTaskTimer(task) {
      stopTaskTimer(task);
      task.timerId = setInterval(() => {
        if (task.status === 'running') updateRunningTaskDuration(task);
      }, 1000);
    }

    function stopTaskTimer(task) {
      if (task.timerId) {
        clearInterval(task.timerId);
        task.timerId = null;
      }
    }

    function formatDurationMs(ms) {
      const totalSeconds = Math.max(0, Math.floor(ms / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      if (minutes <= 0) return `${seconds} 秒`;
      return `${minutes} 分 ${seconds} 秒`;
    }

