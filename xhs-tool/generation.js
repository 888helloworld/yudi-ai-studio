function initGenerateImage() {
  const btn = document.getElementById('generateBtn');
  btn.addEventListener('click', generateImage);
}

function createClientTaskId() {
  if (window.crypto?.randomUUID) return `task_${window.crypto.randomUUID()}`;
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getPendingTasks() {
  try {
    const tasks = JSON.parse(localStorage.getItem(PENDING_XHS_TASKS_KEY) || '[]');
    return Array.isArray(tasks) ? tasks : [];
  } catch {
    return [];
  }
}

function savePendingTasks(tasks) {
  localStorage.setItem(PENDING_XHS_TASKS_KEY, JSON.stringify(tasks));
}

function persistPendingTask(card) {
  if (!card || card.dataset.status !== 'running') return;
  const tasks = getPendingTasks().filter((task) => task.id !== card.id);
  tasks.push({
    id: card.id,
    type: card.dataset.taskType,
    message: card.dataset.taskMessage || '正在生成...',
    historyKey: card.dataset.historyKey || '',
    createdAt: Date.now()
  });
  savePendingTasks(tasks);
}

function forgetPendingTask(taskId) {
  savePendingTasks(getPendingTasks().filter((task) => task.id !== taskId));
}

function restorePendingTasks() {
  const cutoff = Date.now() - 15 * 60 * 1000;
  const pending = getPendingTasks().filter((task) => task.createdAt >= cutoff);
  savePendingTasks(pending);
  const tasksGrid = document.getElementById('tasksGrid');
  if (!tasksGrid) return;
  pending.forEach((task) => {
    if (document.getElementById(task.id)) return;
    const card = createTaskCard(task.id, task.type, task.message);
    card.dataset.historyKey = task.historyKey || '';
    tasksGrid.appendChild(card);
    activeTasks.push(card.id);
  });
  updateXhsHistoryView(document.querySelector('.xhs-tool-tab.active')?.dataset.xhsTool || 'image');
}

function matchesPendingTask(task, history) {
  return Boolean(task.id && history.client_task_id === task.id);
}

function reconcilePendingTasks() {
  const pending = getPendingTasks();
  if (!pending.length) return;
  pending.forEach((task) => {
    if (serverHistory.some((history) => matchesPendingTask(task, history))) removeTask(task.id);
  });
}

function startPendingTaskPolling() {
  if (pendingTaskPollTimer) return;
  pendingTaskPollTimer = window.setInterval(() => {
    if (getPendingTasks().length) loadServerHistory();
  }, 4000);
}

async function generateImage() {
  if (!localStorage.getItem('token')) {
    alert('请先登录');
    return;
  }
  
  const prompt = document.getElementById('imgPrompt').value.trim();
  if (!prompt) {
    alert('请输入图片描述');
    return;
  }

  const imageCount = getImageCountInput('imageGenerateCount');
  const styleText = [...activePresets].join('，');
  const fullPrompt = styleText ? `${prompt}，${styleText}` : prompt;

  const taskId = createClientTaskId();
  const taskCard = createTaskCard(taskId, 'image', `图片生成中（${imageCount}张）...`);
  taskCard.dataset.historyKey = fullPrompt;
  addTask(taskCard);

  const formData = new FormData();
  formData.append('prompt', fullPrompt);
  formData.append('ratio', selectedRatio);
  formData.append('imageCount', imageCount);
  formData.append('clientTaskId', taskId);
  
  const referenceInput = document.getElementById('referenceImage');
  if (referenceInput.files[0]) {
    try {
      const referenceFile = await prepareReferenceImageForUpload(referenceInput.files[0]);
      formData.append('referenceImage', referenceFile, referenceFile.name || 'reference.jpg');
    } catch (err) {
      updateTaskCard(taskId, { error: err.message || '参考图处理失败' });
      return;
    }
  }

  try {
    const res = await fetch('/generate', { 
      method: 'POST', 
      body: formData,
      headers: getAuthHeader()
    });
    const data = await res.json();

    if (data.imageUrl || data.imageUrls?.length) {
      if (data.remainingPoints !== undefined) {
        updatePoints(data.remainingPoints);
      }
      updateTaskCard(taskId, {
        type: 'image',
        imageUrl: data.imageUrl,
        imageUrls: data.imageUrls,
        createdAt: data.createdAt,
        prompt: prompt,
        ratio: selectedRatio
      });
      loadServerHistory();
    } else {
      updateTaskCard(taskId, { error: data.error || '生成失败' });
    }
  } catch (err) {
    updateTaskCard(taskId, { error: '请求失败：' + err.message });
  }
}

// =============================================
// 鏂囨鐢熸垚
// =============================================
function initGenerateCopy() {
  const btn = document.getElementById('generateCopyBtn');
  btn.addEventListener('click', generateCopy);
}

async function generateCopy() {
  if (!localStorage.getItem('token')) {
    alert('请先登录');
    return;
  }
  
  const topic = document.getElementById('copyTopic').value.trim();
  if (!topic) {
    alert('请输入内容主题');
    return;
  }

  const taskId = createClientTaskId();
  const taskCard = createTaskCard(taskId, 'copy', '文案生成中...');
  taskCard.dataset.historyKey = topic;
  addTask(taskCard);

  try {
    const res = await fetch('/generate-copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ topic, type: selectedCopyType, clientTaskId: taskId })
    });
    const data = await res.json();

    if (data.copy) {
      if (data.remainingPoints !== undefined) {
        updatePoints(data.remainingPoints);
      }
      updateTaskCard(taskId, {
        type: 'copy',
        copy: data.copy,
        createdAt: data.createdAt,
        topic: topic,
        copyType: selectedCopyType,
        isRewrite: false
      });
      loadServerHistory();
    } else {
      updateTaskCard(taskId, { error: data.error || '生成失败' });
    }
  } catch (err) {
    updateTaskCard(taskId, { error: '请求失败：' + err.message });
  }
}

// =============================================
// 鏀瑰啓鐖嗘鏂囨
// =============================================
let selectedRewriteStyle = '原创改写';

function initRewrite() {
  // 椋庢牸閫夋嫨
  document.querySelectorAll('.rewrite-style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rewrite-style-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedRewriteStyle = btn.dataset.style;
    });
  });

  // 鏀瑰啓鎸夐挳
  const btn = document.getElementById('rewriteBtn');
  btn.addEventListener('click', rewriteCopy);
}

// =============================================
// 图文一体生成
// =============================================
function initGenerateBoth() {
  // 比例选择
  const bothPanel = document.querySelector('.both-panel');
  if (!bothPanel) return;
  
  bothPanel.querySelectorAll('.ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      bothPanel.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  
  // 生成按钮
  document.getElementById('generateBothBtn').addEventListener('click', generateBoth);
}

async function generateBoth() {
  if (!localStorage.getItem('token')) {
    alert('请先登录');
    return;
  }
  
  const prompt = document.getElementById('bothPrompt').value.trim();
  if (!prompt) {
    alert('请输入内容描述');
    return;
  }
  
  const ratio = document.querySelector('.both-panel .ratio-btn.active')?.dataset.ratio || '1:1';
  const imageCount = getImageCountInput('bothImageCount');
  
  const taskId = createClientTaskId();
  const taskCard = createTaskCard(taskId, 'both', `图文生成中（${imageCount}张图）...`);
  taskCard.dataset.historyKey = prompt;
  addTask(taskCard);
  
  try {
    const res = await fetch('/generate-both', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ prompt, ratio, imageCount, clientTaskId: taskId })
    });
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || '生成失败');
    }
    
    if (data.remainingPoints !== undefined) {
      updatePoints(data.remainingPoints);
    }
    
    // 更新任务卡片
    updateTaskCard(taskId, {
      type: 'both',
      imageUrl: data.imageUrl,
      imageUrls: data.imageUrls,
      copy: data.copy,
      createdAt: data.createdAt,
      ratio
    });
    
    // 刷新历史记录
    await loadServerHistory();
    
    document.getElementById('bothPrompt').value = '';
  } catch (err) {
    updateTaskCard(taskId, { error: err.message || '生成失败' });
  }
}

XhsTool.generateBoth = generateBoth;

async function rewriteCopy() {
  if (!localStorage.getItem('token')) {
    alert('请先登录');
    return;
  }
  
  const originalText = document.getElementById('rewriteInput').value.trim();
  if (!originalText) {
    alert('请输入要改写的文案');
    return;
  }

  const taskId = createClientTaskId();
  const taskCard = createTaskCard(taskId, 'rewrite', '改写中...');
  taskCard.dataset.historyKey = originalText;
  addTask(taskCard);

  try {
    const res = await fetch('/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ 
        originalText: originalText,
        style: selectedRewriteStyle,
        clientTaskId: taskId
      })
    });
    const data = await res.json();

    if (data.copy) {
      if (data.remainingPoints !== undefined) {
        updatePoints(data.remainingPoints);
      }
      updateTaskCard(taskId, {
        type: 'copy',
        copy: data.copy,
        createdAt: data.createdAt,
        topic: '改写：' + data.title,
        copyType: '改写',
        isRewrite: true
      });
      document.getElementById('rewriteInput').value = '';
      loadServerHistory();
    } else {
      updateTaskCard(taskId, { error: data.error || '改写失败' });
    }
  } catch (err) {
    updateTaskCard(taskId, { error: '请求失败：' + err.message });
  }
}
