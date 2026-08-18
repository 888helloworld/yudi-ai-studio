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
