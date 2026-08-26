    function setReverseImage(file) {
      if (!file.type.startsWith('image/')) {
        setReverseStatus('只能上传图片文件。', 'error');
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        setReverseStatus('图片不能超过 5MB。', 'error');
        return false;
      }

      reverseSelectedFile = file;
      if (reversePreviewUrl) URL.revokeObjectURL(reversePreviewUrl);
      reversePreviewUrl = URL.createObjectURL(file);
      reverseDropHint.style.display = 'none';
      reversePreview.innerHTML = '';

      const img = document.createElement('img');
      img.src = reversePreviewUrl;
      img.alt = '反推图片预览';
      const name = document.createElement('div');
      name.className = 'reverse-file-name';
      name.textContent = file.name;
      const remove = document.createElement('button');
      remove.className = 'remove-ref';
      remove.type = 'button';
      remove.textContent = '×';
      remove.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearReverseImage();
      });

      reversePreview.append(img, name, remove);
      reverseBtn.disabled = false;
      setReverseStatus('图片已上传，可以开始反推提示词。', 'ok');
      return true;
    }

    function clearReverseImage(options = {}) {
      const { silent = false } = options;
      reverseSelectedFile = null;
      reverseImageInput.value = '';
      if (reversePreviewUrl) URL.revokeObjectURL(reversePreviewUrl);
      reversePreviewUrl = '';
      reversePreview.innerHTML = '';
      reverseDropHint.style.display = 'block';
      reverseBtn.disabled = true;
      if (!silent) setReverseStatus('已移除图片。', '');
    }

    async function runReversePrompt() {
      if (!reverseSelectedFile) {
        setReverseStatus('请先上传图片。', 'error');
        return;
      }

      const file = reverseSelectedFile;
      const queuedPreviewUrl = URL.createObjectURL(file);
      const localId = `reverse-local-${Date.now()}-${++state.reverseSeq}`;
      const item = {
        localId,
        title: file.name || '图片 Prompt',
        previewUrl: queuedPreviewUrl,
        createdAt: formatBeijingTime(),
        durationMs: 0,
        status: 'running',
        data: null,
        error: ''
      };
      activeReverseRequests += 1;
      state.reverseHistory.unshift(item);
      state.reversePage = 1;
      renderReverseHistoryPage();
      clearReverseImage({ silent: true });
      setReverseStatus('已加入识图，完成后会出现在记录里。', 'ok');

      try {
        const startedAtMs = Date.now();
        const form = new FormData();
        form.append('image', file, file.name || 'image.png');
        form.append('reverseMode', state.reverseMode || 'general');
        form.append('clientTaskId', localId);
        const res = await fetch('/api/xi-image/reverse-prompt', {
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
          throw new Error((data.error || '反推失败') + detail);
        }
        item.status = 'done';
        item.historyId = data.historyId;
        item.title = data.result?.title || file.name || '图片 Prompt';
        item.createdAt = data.createdAt || item.createdAt;
        item.durationMs = data.durationMs || (Date.now() - startedAtMs);
        if (data.previewUrl && item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
        item.previewUrl = data.previewUrl || item.previewUrl;
        item.data = data;
        updateNavPoints(data.remainingPoints);
        renderReverseHistoryPage();
        if (!reverseSelectedFile) setReverseStatus('Prompt 已生成，可在右侧记录中查看。', 'ok');
      } catch (err) {
        item.status = 'failed';
        item.error = err.message || '反推失败';
        item.durationMs = item.durationMs || 0;
        renderReverseHistoryPage();
        if (!reverseSelectedFile) setReverseStatus(item.error, 'error');
      } finally {
        activeReverseRequests = Math.max(0, activeReverseRequests - 1);
        syncReverseHistoryPolling();
      }
    }

    async function loadReverseHistory() {
      try {
        const res = await fetch('/api/user/history?type=reverse&limit=200', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) handleAuthExpired(data.error || '登录已过期，请重新登录。');
          return;
        }
        const data = await res.json();
        state.reverseHistory = (data.history || [])
          .filter((item) => item.sub_type === 'xi-reverse')
          .map((item) => {
            const meta = parseJson(item.content) || {};
            const status = ['running', 'failed', 'done'].includes(meta.status) ? meta.status : 'done';
            return {
              historyId: item.id,
              localId: item.client_task_id || '',
              title: meta.result?.title || meta.file || item.prompt || '图片反推提示词',
              previewUrl: meta.preview_url || '',
              createdAt: formatHistoryTime(item.created_at),
              durationMs: meta.duration_ms || 0,
              status,
              error: meta.error || '',
              data: status === 'done' ? {
                model: meta.model || 'gpt-5.5',
                result: meta.result || null,
                raw: meta.raw || '',
                previewUrl: meta.preview_url || '',
                createdAt: formatHistoryTime(item.created_at),
                durationMs: meta.duration_ms || 0
              } : null
            };
          });
        state.reversePage = 1;
        renderReverseHistoryPage();
      } catch {}
    }

    function prependReverseHistory(data) {
      state.reverseHistory.unshift({
        historyId: data.historyId,
        title: data.result?.title || '图片反推提示词',
        previewUrl: data.previewUrl || '',
        createdAt: data.createdAt || '',
        durationMs: data.durationMs || 0,
        status: 'done',
        data
      });
      state.reversePage = 1;
      renderReverseHistoryPage();
    }

    function renderReverseHistoryPage() {
      reverseHistoryEl.innerHTML = '';
      const total = state.reverseHistory.length;
      reverseEmptyEl.style.display = total === 0 ? 'flex' : 'none';
      reversePagerEl.style.display = total > state.reversePageSize ? 'flex' : 'none';
      if (total === 0) return;

      const totalPages = getReverseTotalPages();
      state.reversePage = Math.min(Math.max(state.reversePage, 1), totalPages);
      const start = (state.reversePage - 1) * state.reversePageSize;
      state.reverseHistory
        .slice(start, start + state.reversePageSize)
        .forEach((item) => reverseHistoryEl.appendChild(createReverseHistoryCard(item)));

      reversePageInfoEl.textContent = `第 ${state.reversePage} / ${totalPages} 页 · 共 ${total} 条`;
      reversePrevPageBtn.disabled = state.reversePage <= 1;
      reverseNextPageBtn.disabled = state.reversePage >= totalPages;
      syncReverseHistoryPolling();
    }

    function syncReverseHistoryPolling() {
      const shouldPoll = activeReverseRequests === 0 && state.reverseHistory.some((item) => item.status === 'running');
      if (!shouldPoll) {
        if (reverseHistoryPollId) clearTimeout(reverseHistoryPollId);
        reverseHistoryPollId = null;
        return;
      }
      if (reverseHistoryPollId) return;
      reverseHistoryPollId = setTimeout(async () => {
        reverseHistoryPollId = null;
        await loadReverseHistory();
        syncReverseHistoryPolling();
      }, 3000);
    }

    function getReverseTotalPages() {
      return Math.max(1, Math.ceil(state.reverseHistory.length / state.reversePageSize));
    }

    function createReverseHistoryCard(item) {
      const card = document.createElement('div');
      card.className = 'reverse-history-card';
      const statusText = item.status === 'running' ? '识图中' : (item.status === 'failed' ? '失败' : '完成');
      const thumb = item.previewUrl || item.data?.previewUrl || '';
      const thumbHtml = thumb
        ? '<img class="reverse-history-thumb" alt="识图缩略图">'
        : '<div class="reverse-history-thumb placeholder">图</div>';
      card.innerHTML = `${thumbHtml}<div class="reverse-history-info">
          <h4>${escapeHtml(item.title)}</h4>
          <p>${escapeHtml(item.createdAt || '-')} · ${statusText}${item.durationMs ? ' · 用时 ' + formatDurationMs(item.durationMs) : ''}</p>
        </div>`;
      const summary = getReversePromptSummary(item);
      if (summary) {
        const summaryEl = document.createElement('div');
        summaryEl.className = 'reverse-history-summary';
        summaryEl.textContent = summary;
        card.querySelector('.reverse-history-info').appendChild(summaryEl);
      }
      const thumbEl = card.querySelector('img.reverse-history-thumb');
      if (thumbEl) {
        setProtectedImageSource(thumbEl, thumb, '识图缩略图');
        thumbEl.addEventListener('click', () => {
          openStandaloneImagePreview(thumb, item.title || '看图写 Prompt 原图', `reverse_prompt_${item.historyId || Date.now()}.png`);
        });
      }
      const btn = document.createElement('button');
      btn.className = 'xi-small-btn reverse-prompt-btn';
      btn.type = 'button';
      btn.textContent = item.status === 'running' ? '生成中' : (item.status === 'failed' ? '查看错误' : '查看提示词');
      btn.disabled = item.status === 'running';
      btn.addEventListener('click', () => {
        if (item.status === 'failed') {
          setReverseStatus(item.error || '反推失败', 'error');
          return;
        }
        if (item.data) openPromptPreview(item.data);
      });
      card.querySelector('.reverse-history-info').appendChild(btn);
      return card;
    }

    function getReversePromptSummary(item) {
      if (item.status === 'failed') return item.error || '';
      const result = item.data?.result || {};
      return result.polished_prompt_zh
        || result.polished_prompt_en
        || result.universal_prompt_zh
        || result.universal_prompt_en
        || result.dalle_prompt
        || result.midjourney_prompt
        || item.data?.raw
        || '';
    }

    function addReverseBlock(title, text, copyable, targetEl = promptPreviewBody) {
      if (!text) return;
      const block = document.createElement('section');
      block.className = 'prompt-block';
      const header = document.createElement('div');
      header.className = 'prompt-block-header';
      const h3 = document.createElement('h3');
      h3.textContent = title;
      header.appendChild(h3);
      const content = document.createElement('div');
      content.className = 'prompt-content' + (copyable ? '' : ' muted');
      content.textContent = text;
      block.append(header, content);
      if (title === '中文 Prompt' || title === '英文 Prompt') {
        const actions = document.createElement('div');
        actions.className = 'prompt-block-actions';
        const useBtn = document.createElement('button');
        useBtn.className = 'prompt-use-btn';
        useBtn.type = 'button';
        useBtn.textContent = '用它生图';
        useBtn.addEventListener('click', () => usePromptForImage(text, title));
        actions.appendChild(useBtn);
        block.appendChild(actions);
      }
      targetEl.appendChild(block);
    }

    function usePromptForImage(text, title = 'Prompt') {
      promptEl.value = text;
      closePromptPreview();
      promptEl.focus();
      promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setStatus(`已填入${title}，可以直接开始出图。`, 'ok');
    }

    function setReverseBusy(busy) {
      reverseBtn.disabled = !reverseSelectedFile;
      const span = reverseBtn.querySelector('span');
      if (span) span.textContent = '加入识图';
    }

    function setReverseStatus(text, type) {
      reverseStatusEl.textContent = text || '';
      reverseStatusEl.className = 'reverse-status' + (type ? ' ' + type : '');
    }
