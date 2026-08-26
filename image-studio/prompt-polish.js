    function setPromptPolishLoading(loading) {
      state.promptPolishLoading = loading;
      if (polishPromptBtn) {
        polishPromptBtn.disabled = loading;
        polishPromptBtn.textContent = loading ? 'DeepSeek 正在润色...' : '✨ DS AI润色';
      }
      if (retryPromptPolishBtn) retryPromptPolishBtn.disabled = loading;
      if (applyPromptPolishBtn) applyPromptPolishBtn.disabled = loading;
    }

    function renderPromptPolishNotes(data) {
      if (!promptPolishNotes) return;
      promptPolishNotes.innerHTML = '';
      const visual = Array.isArray(data.visualUnderstanding) ? data.visualUnderstanding : [];
      const changes = Array.isArray(data.changes) ? data.changes : [];
      const corrections = Array.isArray(data.referenceCorrections) ? data.referenceCorrections : [];
      if (visual.length > 0) {
        const line = document.createElement('div');
        line.textContent = `视觉理解：${visual.join('；')}`;
        promptPolishNotes.appendChild(line);
      }
      if (changes.length > 0) {
        const line = document.createElement('div');
        line.textContent = `本次优化：${changes.join('；')}`;
        promptPolishNotes.appendChild(line);
      }
      corrections.forEach((item) => {
        const inputText = String(item?.inputText || '').trim();
        const referenceValue = String(item?.referenceValue || '').trim();
        if (!inputText || !referenceValue) return;
        const line = document.createElement('div');
        line.className = 'prompt-polish-warning';
        line.textContent = `视觉纠错：文字“${inputText}”与参考图识别“${referenceValue}”不一致，已按参考图修正。`;
        promptPolishNotes.appendChild(line);
      });
    }

    async function polishCurrentPrompt() {
      if (state.promptPolishLoading) return;
      const prompt = promptEl.value.trim();
      if (!prompt) {
        setStatus('请先写一句图片描述，再让 AI 结合参考图润色。', 'error');
        promptEl.focus();
        return;
      }

      const selectedSources = getSelectedSourceImages();
      const requestSeq = ++state.promptPolishSeq;
      const requestId = window.crypto?.randomUUID
        ? `polish_${window.crypto.randomUUID()}`
        : `polish_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const form = new FormData();
      form.append('prompt', prompt);
      form.append('size', state.selectedSize);
      form.append('clientTaskId', requestId);
      form.append('clientRequestId', requestId);
      selectedSources.forEach((source) => {
        form.append('image', source.file, getSourceImageName(source.slotIndex ?? 0));
      });

      state.promptPolishOriginal = prompt;
      state.promptPolishApplied = false;
      promptPolishApplied?.classList.remove('show');
      undoPromptPolishBtn.disabled = true;
      promptPolishCard.classList.add('show');
      promptPolishResult.value = '';
      promptPolishMeta.textContent = selectedSources.length > 0
        ? `正在结合 ${selectedSources.length} 张参考图和 ${state.selectedSize} 画布理解你的想法...`
        : `正在根据 ${state.selectedSize} 画布优化生图描述...`;
      promptPolishNotes.innerHTML = '';
      setPromptPolishLoading(true);

      try {
        const res = await fetch('/api/xi-image/polish-prompt', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token },
          body: form
        });
        const data = await res.json().catch(() => ({}));
        if (requestSeq !== state.promptPolishSeq) return;
        if (!res.ok) {
          if (res.status === 401) handleAuthExpired(data.error || '登录已过期，请重新登录。');
          throw new Error(data.error || '提示词润色失败');
        }
        promptPolishResult.value = data.polishedPrompt || '';
        const modelLabel = data.model === 'deepseek-v4-flash-vision-exp' ? 'DeepSeek V4 视觉' : (data.model || 'DeepSeek');
        promptPolishMeta.textContent = `${selectedSources.length > 0 ? `已结合 ${selectedSources.length} 张参考图` : '已完成文字润色'} · ${modelLabel} · ${state.selectedSize} · 免费`;
        renderPromptPolishNotes(data);
        setStatus('AI 已完成视觉润色，确认后再替换原描述。', 'ok');
      } catch (error) {
        if (requestSeq !== state.promptPolishSeq) return;
        promptPolishMeta.textContent = '这次润色没有完成';
        promptPolishNotes.textContent = error.message || '提示词润色失败，请稍后再试。';
        setStatus(error.message || '提示词润色失败，请稍后再试。', 'error');
      } finally {
        if (requestSeq === state.promptPolishSeq) setPromptPolishLoading(false);
      }
    }

    function applyPolishedPrompt() {
      const polished = promptPolishResult.value.trim();
      if (!polished) {
        setStatus('润色结果还是空的，请重新润色。', 'error');
        return;
      }
      promptEl.value = polished;
      state.promptPolishApplied = true;
      undoPromptPolishBtn.disabled = false;
      promptPolishCard.classList.remove('show');
      promptPolishApplied?.classList.add('show');
      promptEl.focus();
      setStatus('已用润色结果替换图片描述，可以继续修改或直接出图。', 'ok');
    }

    function undoPolishedPrompt() {
      if (!state.promptPolishApplied) return;
      promptEl.value = state.promptPolishOriginal || '';
      state.promptPolishApplied = false;
      undoPromptPolishBtn.disabled = true;
      promptPolishApplied?.classList.remove('show');
      promptPolishCard?.classList.add('show');
      promptEl.focus();
      setStatus('已恢复润色前的图片描述。', 'ok');
    }

    function closePromptPolish() {
      promptPolishCard?.classList.remove('show');
    }

    function resetPromptPolish() {
      state.promptPolishSeq += 1;
      state.promptPolishOriginal = '';
      state.promptPolishApplied = false;
      setPromptPolishLoading(false);
      if (promptPolishResult) promptPolishResult.value = '';
      if (promptPolishNotes) promptPolishNotes.innerHTML = '';
      if (undoPromptPolishBtn) undoPromptPolishBtn.disabled = true;
      promptPolishApplied?.classList.remove('show');
      closePromptPolish();
    }
