function initToolScript() {
  enableKeyboardControls();
  checkLoginStatus();
  initStylePresets();
  initRatioSelector();
  initCopyTypeSelector();
  initDropZone();
  initGenerateImage();
  initGenerateCopy();
  initRewrite();
  initGenerateBoth();
  initXhsToolTabs();
  initXhsWorkStats();
  initXhsReversePrompt();
  initPagination();
  restorePendingTasks();
  startPendingTaskPolling();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initToolScript);
} else {
  initToolScript();
}

