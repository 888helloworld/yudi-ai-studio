    refreshPromptPlaceholder();

    if (!token) {
      document.getElementById('loginPrompt').classList.add('show');
      document.body.classList.add('login-locked');
      generateBtn.disabled = true;
      if (polishPromptBtn) polishPromptBtn.disabled = true;
      if (detailSuiteBtn) detailSuiteBtn.disabled = true;
    } else {
      initUser();
    }
    document.querySelectorAll('.ratio-btn').forEach((control) => {
      control.setAttribute('role', 'button');
      control.tabIndex = 0;
      control.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        control.click();
      });
    });

    document.querySelectorAll('#sizeSelector .ratio-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#sizeSelector .ratio-btn').forEach((item) => item.classList.remove('active'));
        btn.classList.add('active');
        state.selectedSize = btn.dataset.size;
        updateEstimate();
      });
    });

    document.querySelectorAll('#batchCountPicker .count-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#batchCountPicker .count-btn').forEach((item) => item.classList.remove('active'));
        btn.classList.add('active');
        batchCountEl.value = btn.dataset.count || '1';
        updateEstimate();
      });
    });

    parallelismEl?.addEventListener('input', () => {
      parallelismEl.value = Math.max(Math.floor(Number(parallelismEl.value || 1)), 1);
      updateEstimate();
      updateStats();
      processQueue();
    });

    countEl.addEventListener('input', updateEstimate);
    batchCountEl.addEventListener('input', updateEstimate);

    sourceSlots.forEach((slot) => {
      const index = Number(slot.dataset.sourceSlot || 0);
      const input = slot.querySelector('.source-image-input');
      slot.tabIndex = 0;
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) setSourceImage(index, file);
      });

      ['dragenter', 'dragover'].forEach((eventName) => {
        slot.addEventListener(eventName, (event) => {
          event.preventDefault();
          slot.classList.add('drag-over');
        });
      });

      ['dragleave', 'drop'].forEach((eventName) => {
        slot.addEventListener(eventName, (event) => {
          event.preventDefault();
          slot.classList.remove('drag-over');
        });
      });

      slot.addEventListener('drop', (event) => {
        const sourceIndex = getDraggedSourceIndex(event);
        if (sourceIndex !== null) {
          moveSourceImage(sourceIndex, index);
          return;
        }
        const file = event.dataTransfer?.files?.[0];
        if (file) setSourceImage(index, file);
      });
    });

    sourceGrid.addEventListener('click', () => {
      pasteTargetMode = 'source';
      const emptyIndex = getFirstEmptySourceIndex();
      if (emptyIndex >= 0) sourceSlots[emptyIndex].focus();
    });
    sourceGrid.addEventListener('pointerenter', () => {
      pasteTargetMode = 'source';
    });
    document.addEventListener('paste', handleSourcePaste);

    generateBtn.addEventListener('click', enqueueTasks);
    polishPromptBtn?.addEventListener('click', polishCurrentPrompt);
    retryPromptPolishBtn?.addEventListener('click', polishCurrentPrompt);
    applyPromptPolishBtn?.addEventListener('click', applyPolishedPrompt);
    undoPromptPolishBtn?.addEventListener('click', undoPolishedPrompt);
    undoAppliedPromptBtn?.addEventListener('click', undoPolishedPrompt);
    closePromptPolishBtn?.addEventListener('click', closePromptPolish);
    clearPromptBtn.addEventListener('click', () => {
      promptEl.value = '';
      resetPromptPolish();
      refreshPromptPlaceholder();
      promptEl.focus();
      setStatus('已清空图片描述。', 'ok');
    });
    clearSourcesBtn.addEventListener('click', clearAllSourceImages);
    detailSuiteBtn?.addEventListener('click', enqueueDetailSuite);
    [
      detailProductNameEl,
      detailPlatformEl,
      detailSellingPointsEl,
      detailSpecsEl,
      detailStyleEl,
      detailToneEl,
      detailBrandColorEl,
      detailFontEl,
      detailCountEl,
      detailSizeEl
    ].forEach((el) => {
      if (!el) return;
      el.addEventListener('input', renderDetailSuitePreview);
      el.addEventListener('change', renderDetailSuitePreview);
    });
    reloadHistoryBtn?.addEventListener('click', () => loadSavedTasks({ force: true }));
    clearQueuedBtn?.addEventListener('click', clearQueuedTasks);
    taskPageSizeEl.addEventListener('change', async () => {
      state.taskPageSize = clamp(Number(taskPageSizeEl.value || 12), 12, 100);
      state.taskPage = 1;
      await ensureTaskPageLoaded(1);
      renderTaskPage();
      updateStats();
    });
    taskPrevPageBtn.addEventListener('click', () => {
      state.taskPage = Math.max(1, state.taskPage - 1);
      renderTaskPage();
      updateStats();
    });
    taskNextPageBtn.addEventListener('click', async () => {
      const totalPages = getTaskTotalPages();
      const nextPage = Math.min(totalPages, state.taskPage + 1);
      await ensureTaskPageLoaded(nextPage);
      state.taskPage = Math.min(getTaskTotalPages(), nextPage);
      renderTaskPage();
      updateStats();
    });
    previewClose.addEventListener('click', closeImagePreview);
    previewDownload.addEventListener('click', (event) => {
      event.preventDefault();
      downloadImageFile(previewDownload.href, previewDownload.download || 'xi_xu_image.png');
    });
    previewOpen.addEventListener('click', (event) => {
      event.preventDefault();
      openImageInNewTab(currentPreviewImage?.url || previewOpen.href);
    });
    previewEditBtn.addEventListener('click', usePreviewImageAsSource);
    previewOverlay.addEventListener('click', (event) => {
      if (event.target === previewOverlay) closeImagePreview();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (previewOverlay.classList.contains('show')) closeImagePreview();
    });
    updateEstimate();
    if (detailSuitePreviewEl) renderDetailSuitePreview();
    renderTaskPage();
    updateStats();

  (() => {
    function setNativeControl(selector, value) {
      document.querySelectorAll(selector).forEach((el) => {
        if (el.tagName === 'SELECT') {
          const hasOption = Array.from(el.options || []).some((option) => option.value === value);
          if (!hasOption || el.value === value) return;
          el.value = value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
        if ((el.type === 'radio' || el.type === 'checkbox') && el.value === value && !el.checked) {
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }

    function clickSegmentButton(attribute, value) {
      document.querySelectorAll(`[${attribute}="${value}"]`).forEach((el) => {
        if (el instanceof HTMLButtonElement || el.getAttribute('role') === 'button') {
          el.click();
        }
      });
    }

    function applyImageStudioDefaults() {
      setNativeControl('select, input[type="radio"], input[type="checkbox"]', '1024x1536');
      setNativeControl('select, input[type="radio"], input[type="checkbox"]', 'high');
      ['data-size', 'data-value', 'data-ratio', 'data-quality'].forEach((attr) => {
        clickSegmentButton(attr, '1024x1536');
        clickSegmentButton(attr, 'high');
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyImageStudioDefaults);
    } else {
      applyImageStudioDefaults();
    }
  })();
