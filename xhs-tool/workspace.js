function enableKeyboardControls() {
  const selector = '.ratio-btn,.preset-tag,.copy-type-btn,.rewrite-style-btn,.quality-btn,.count-btn';
  document.querySelectorAll(selector).forEach((control) => {
    if (control.tagName === 'BUTTON') return;
    control.setAttribute('role', 'button');
    control.tabIndex = 0;
    control.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      control.click();
    });
  });
}

function initXhsToolTabs() {
  const switcher = document.getElementById('xhsToolSwitcher');
  if (!switcher) return;
  const tabs = Array.from(switcher.querySelectorAll('[data-xhs-tool]'));
  const panels = Array.from(document.querySelectorAll('[data-xhs-panel]'));
  if (!tabs.length || !panels.length) return;

XhsTool.switchTool = function(tool) {
    const nextTool = tabs.some((tab) => tab.dataset.xhsTool === tool) ? tool : 'image';
    tabs.forEach(tab => {
      const active = tab.dataset.xhsTool === nextTool;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach(panel => {
      panel.hidden = panel.dataset.xhsPanel !== nextTool;
    });
    sessionStorage.setItem(XHS_ACTIVE_TOOL_KEY, nextTool);
    updateXhsHistoryView(nextTool);
  };

  tabs.forEach(tab => {
    tab.setAttribute('aria-selected', tab.classList.contains('active') ? 'true' : 'false');
    tab.addEventListener('click', () => XhsTool.switchTool(tab.dataset.xhsTool));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      tabs[(tabs.indexOf(tab) + direction + tabs.length) % tabs.length].focus();
    });
  });
  XhsTool.switchTool(sessionStorage.getItem(XHS_ACTIVE_TOOL_KEY) || 'image');
}

function updateXhsHistoryView(tool) {
  document.querySelectorAll('[data-xhs-history-section]').forEach((section) => {
    section.hidden = section.dataset.xhsHistorySection !== tool;
  });

  const activeHistorySection = document.querySelector(`[data-xhs-history-section="${tool}"]`);
  const paginationSettings = document.querySelector('.pagination-settings');
  if (paginationSettings) {
    paginationSettings.hidden = !activeHistorySection?.querySelector('.history-card');
  }

  const tasksSection = document.getElementById('tasksSection');
  const taskCards = Array.from(document.querySelectorAll('.task-card'));
  const visibleTasks = taskCards.filter((card) => card.dataset.taskType === tool);
  taskCards.forEach((card) => { card.hidden = card.dataset.taskType !== tool; });
  if (tasksSection) tasksSection.style.display = visibleTasks.length ? 'block' : 'none';
}

function initXhsWorkStats() {
  const concurrency = document.getElementById('xhsStatConcurrency');
  if (concurrency) {
    concurrency.addEventListener('input', () => {
      const value = Math.max(Math.floor(Number(concurrency.value || 1)), 1);
      concurrency.value = value;
      updateXhsWorkStats();
    });
  }
  updateXhsWorkStats();
}
async function checkLoginStatus() {
  const token = localStorage.getItem('token');
  
  if (!token) {
    showLoginPrompt();
    return;
  }
  
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) throw new Error();
    
    const data = await res.json();
    const user = data.user || data;
    currentUser = user;
    showUserBar(user);
    await loadServerHistory();
  } catch {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    showLoginPrompt();
  }
}

function showLoginPrompt() {
  document.getElementById('loginPrompt').style.display = 'flex';
  document.getElementById('userBar').style.display = 'none';
}

function showUserBar(user) {
  document.getElementById('loginPrompt').style.display = 'none';
  document.getElementById('userBar').style.display = 'flex';
  document.getElementById('userName').textContent = user.username;
  document.getElementById('userPoints').textContent = `积分: ${user.points}`;
  
  if (user.role === 'admin') {
    document.getElementById('adminLink').style.display = 'block';
  }
  
  // 避免重复绑定
  const logoutBtn = document.getElementById('logoutBtn');
  const newBtn = logoutBtn.cloneNode(true);
  logoutBtn.parentNode.replaceChild(newBtn, logoutBtn);
  newBtn.addEventListener('click', async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    location.reload();
  });
}

function updatePoints(points) {
  const normalizedPoints = Number(points) || 0;
  if (currentUser) {
    currentUser.points = normalizedPoints;
    const userPoints = document.getElementById('userPoints');
    if (userPoints) userPoints.textContent = `积分: ${normalizedPoints}`;
  }
  const navPoints = document.getElementById('navPoints');
  if (navPoints) navPoints.textContent = `${normalizedPoints} 积分`;
}

// =============================================
// 椋庢牸棰勮
// =============================================
function initStylePresets() {
  document.querySelectorAll('.preset-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      // 鍗曢€夋ā寮忥細鍙栨秷鍏朵粬閫変腑锛屽彧淇濈暀褰撳墠
      document.querySelectorAll('.preset-tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePresets.clear();
      activePresets.add(btn.dataset.style);
    });
  });
  const firstPreset = document.querySelector('.preset-tag');
  if (firstPreset) {
    firstPreset.classList.add('active');
    activePresets.add(firstPreset.dataset.style);
  }
}

// =============================================
// 姣斾緥閫夋嫨鍣?// =============================================
function initRatioSelector() {
  document.querySelectorAll('.ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedRatio = btn.dataset.ratio;
    });
  });
}

// =============================================
// 鏂囨绫诲瀷閫夋嫨鍣?// =============================================
function initCopyTypeSelector() {
  document.querySelectorAll('.copy-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.copy-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedCopyType = btn.dataset.type;
    });
  });
}

// =============================================
// 鎷栨嫿涓婁紶
// =============================================
function initDropZone() {
  const dropZone = document.getElementById('dropZone');
  const dropHint = document.getElementById('dropHint');
  const previewRef = document.getElementById('previewRef');
  const referenceInput = document.getElementById('referenceImage');
  const promptInput = document.getElementById('imgPrompt');
  if (!dropZone || !dropHint || !previewRef || !referenceInput) return;

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setReferenceFile(file);
    }
  });

  referenceInput.addEventListener('change', () => {
    const file = referenceInput.files[0];
    if (file) showPreview(file);
  });

  dropZone.addEventListener('click', () => {
    dropZone.classList.add('paste-ready');
    setTimeout(() => dropZone.classList.remove('paste-ready'), 1800);
  });

  document.addEventListener('paste', (e) => {
    const file = getImageFileFromClipboard(e.clipboardData);
    if (!file) return;
    const active = document.activeElement;
    if (active?.closest?.('#xhsReverseDropZone') || active?.closest?.('#xhsReverseModeGrid')) return;
    const shouldPasteToReference = dropZone.contains(active)
      || active === promptInput
      || active === referenceInput
      || active === document.body;
    if (!shouldPasteToReference) return;
    e.preventDefault();
    setReferenceFile(file);
    dropZone.classList.add('paste-ready');
    setTimeout(() => dropZone.classList.remove('paste-ready'), 900);
  });

  function setReferenceFile(file) {
    const namedFile = file.name
      ? file
      : new File([file], `pasted-reference-${Date.now()}.png`, { type: file.type || 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(namedFile);
    referenceInput.files = dt.files;
    showPreview(namedFile);
  }

  function showPreview(file) {
    if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    const url = URL.createObjectURL(file);
    referencePreviewUrl = url;
    previewRef.innerHTML = `<img src="${url}" alt="参考图"><button class="remove-ref" data-xhs-action="remove-reference" aria-label="移除参考图">×</button>`;
    dropHint.style.display = 'none';
  }
}

XhsTool.removeReference = function() {
  const previewRef = document.getElementById('previewRef');
  const dropHint = document.getElementById('dropHint');
  const referenceInput = document.getElementById('referenceImage');
  if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
  referencePreviewUrl = '';
  previewRef.innerHTML = '';
  dropHint.style.display = 'flex';
  referenceInput.value = '';
};

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-xhs-action="remove-reference"]')) XhsTool.removeReference();
});

function initXhsReversePrompt() {
  const dropZone = document.getElementById('xhsReverseDropZone');
  const input = document.getElementById('xhsReverseImage');
  const btn = document.getElementById('xhsReverseBtn');
  const modeGrid = document.getElementById('xhsReverseModeGrid');
  if (!dropZone || !input || !btn || !modeGrid) return;
  dropZone.tabIndex = 0;

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) setXhsReverseFile(file);
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('drag-over');
    });
  });

  dropZone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) setXhsReverseFile(file);
  });

  dropZone.addEventListener('click', () => {
    dropZone.focus();
    dropZone.classList.add('paste-ready');
    setTimeout(() => dropZone.classList.remove('paste-ready'), 1800);
  });

  document.addEventListener('paste', (event) => {
    const file = getImageFileFromClipboard(event.clipboardData);
    if (!file) return;
    const active = document.activeElement;
    const shouldPaste = dropZone.contains(active) || active === document.body;
    if (!shouldPaste) return;
    event.preventDefault();
    setXhsReverseFile(file.name ? file : new File([file], `pasted-reverse-${Date.now()}.png`, { type: file.type || 'image/png' }));
    dropZone.classList.add('paste-ready');
    setTimeout(() => dropZone.classList.remove('paste-ready'), 900);
  });

  modeGrid.addEventListener('click', (event) => {
    const modeBtn = event.target.closest('[data-reverse-mode]');
    if (!modeBtn) return;
    selectedReverseMode = modeBtn.dataset.reverseMode || 'general';
    modeGrid.querySelectorAll('[data-reverse-mode]').forEach(item => item.classList.toggle('active', item === modeBtn));
    const hint = document.getElementById('xhsReverseHint');
    if (hint) hint.textContent = REVERSE_TEMPLATE_HINTS[selectedReverseMode] || REVERSE_TEMPLATE_HINTS.general;
  });

  btn.addEventListener('click', runXhsReversePrompt);
}

function setXhsReverseFile(file) {
  if (!file.type.startsWith('image/')) {
    setXhsReverseStatus('只能上传图片文件。', 'error');
    return false;
  }
  if (file.size > 10 * 1024 * 1024) {
    setXhsReverseStatus('图片不能超过 10MB。', 'error');
    return false;
  }

  xhsReverseFile = file;
  const input = document.getElementById('xhsReverseImage');
  if (input && window.DataTransfer && (!input.files || input.files[0] !== file)) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  }
  if (xhsReversePreviewUrl) URL.revokeObjectURL(xhsReversePreviewUrl);
  xhsReversePreviewUrl = URL.createObjectURL(file);
  const hint = document.getElementById('xhsReverseDropHint');
  const preview = document.getElementById('xhsReversePreview');
  if (hint) hint.style.display = 'none';
  if (preview) {
    preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = xhsReversePreviewUrl;
    img.alt = '反推参考图';
    const name = document.createElement('div');
    name.className = 'xhs-reverse-file';
    name.textContent = file.name || '粘贴图片';
    const remove = document.createElement('button');
    remove.className = 'remove-ref';
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearXhsReverseFile();
    });
    preview.append(img, name, remove);
  }
  document.getElementById('xhsReverseBtn').disabled = false;
  setXhsReverseStatus('图片已放入，可以反推 Prompt。', 'ok');
  return true;
}

function clearXhsReverseFile() {
  xhsReverseFile = null;
  const input = document.getElementById('xhsReverseImage');
  const hint = document.getElementById('xhsReverseDropHint');
  const preview = document.getElementById('xhsReversePreview');
  if (input) input.value = '';
  if (xhsReversePreviewUrl) URL.revokeObjectURL(xhsReversePreviewUrl);
  xhsReversePreviewUrl = '';
  if (preview) preview.innerHTML = '';
  if (hint) hint.style.display = 'flex';
  const btn = document.getElementById('xhsReverseBtn');
  if (btn) btn.disabled = true;
  setXhsReverseStatus('已移除图片。', '');
}

async function runXhsReversePrompt() {
  if (!localStorage.getItem('token')) {
    alert('请先登录');
    return;
  }
  if (!xhsReverseFile) {
    setXhsReverseStatus('请先上传或粘贴图片。', 'error');
    return;
  }

  setXhsReverseStatus('正在识图并生成 Prompt...', '');

  try {
    const form = new FormData();
    form.append('image', xhsReverseFile, xhsReverseFile.name || 'reverse.png');
    form.append('reverseMode', selectedReverseMode || 'general');
    form.append('historySource', 'xhs');
    const res = await fetch('/api/xi-image/reverse-prompt', {
      method: 'POST',
      headers: getAuthHeader(),
      body: form
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '反推失败');
    if (data.remainingPoints !== undefined) updatePoints(data.remainingPoints);
    clearXhsReverseFile();
    openReversePromptModal(data);
    await loadServerHistory({ force: true });
    setXhsReverseStatus('Prompt 已生成，已保存到反推记录。', 'ok');
  } catch (err) {
    setXhsReverseStatus(err.message || '反推失败', 'error');
  }
}

function setXhsReverseStatus(text, type) {
  const status = document.getElementById('xhsReverseStatus');
  if (!status) return;
  status.textContent = text || '';
  status.className = 'xhs-reverse-status' + (type ? ' ' + type : '');
}
