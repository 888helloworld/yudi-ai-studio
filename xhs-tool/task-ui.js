function createTaskCard(id, type, message) {
  const typeLabel = type === 'image' ? '图片' : (type === 'both' ? '图文' : (type === 'rewrite' ? '改写' : '文案'));
  const card = document.createElement('div');
  card.className = 'task-card';
  card.id = id;
  card.dataset.status = 'running';
  card.dataset.taskType = type;
  card.dataset.taskMessage = message;
  card.innerHTML = `
    <div class="task-header">
      <span class="task-type ${type}">${typeLabel}</span>
    </div>
    <div class="task-body">
      <div class="xhs-task-state"><span class="task-type ${type}">生成中</span></div>
      <div class="task-loading">
        <div class="spinner"></div>
        <span>${message}</span>
      </div>
    </div>
  `;
  return card;
}

function addTask(card) {
  const tasksSection = document.getElementById('tasksSection');
  const tasksGrid = document.getElementById('tasksGrid');
  tasksSection.style.display = 'block';
  tasksGrid.appendChild(card);
  activeTasks.push(card.id);
  persistPendingTask(card);
  updateXhsWorkStats();
  
  updateXhsHistoryView(document.querySelector('.xhs-tool-tab.active')?.dataset.xhsTool || 'image');
}

function updateTaskCard(taskId, data) {
  const card = document.getElementById(taskId);
  if (!card) return;

  const body = card.querySelector('.task-body');

  if (data.error) {
    card.dataset.status = 'failed';
    body.innerHTML = `<div class="xhs-task-state"><span class="task-type">失败</span></div><div class="task-error">${escapeHtml(data.error)}</div>`;
    forgetPendingTask(taskId);
    updateXhsWorkStats();
    return;
  }

  if (data.type === 'image') {
    card.dataset.status = 'done';
    const imageUrls = Array.isArray(data.imageUrls) && data.imageUrls.length ? data.imageUrls : [data.imageUrl].filter(Boolean);
    const imageHtml = imageUrls.map(url => protectedImageHtml(url, '生成的图片', 'task-image')).join('');
    const encodedImageUrls = encodeURIComponent(JSON.stringify(imageUrls));
    const encodedPrompt = encodeURIComponent(data.prompt || '');
    const actionsHtml = imageUrls.length
      ? `<button class="task-btn" onclick="downloadImagesFromEncoded('${encodedImageUrls}', decodeURIComponent('${encodedPrompt}'), '${escapeJsString(data.ratio || '1:1')}')">${imageUrls.length > 1 ? '下载全部图片' : '下载图片'}</button>`
      : '';
    body.innerHTML = `
      <div class="task-image-grid">${imageHtml}</div>
      <div class="xhs-task-state"><span class="task-type">完成</span></div>
      <div class="task-meta">${escapeHtml(data.ratio || '1:1')} · ${imageUrls.length} 张 · ${escapeHtml(data.createdAt || '')}</div>
      <div class="task-actions">
        ${actionsHtml}
      </div>
    `;
  } else if (data.type === 'copy') {
    card.dataset.status = 'done';
    const typeLabel = data.isRewrite ? '改写' : (data.copyType || '生成');
    const header = card.querySelector('.task-header');
    const typeSpan = header.querySelector('.task-type');
    if (typeSpan) typeSpan.textContent = typeLabel;
    
    body.innerHTML = `
      <div class="xhs-task-state"><span class="task-type copy-type">完成</span></div>
      <div class="task-copy">${escapeHtml(data.copy)}</div>
      <div class="task-meta">${escapeHtml(typeLabel)} · ${escapeHtml(data.createdAt || '')}</div>
      <div class="task-actions">
        <button class="task-btn" onclick="copyText(this, \`${escapeQuotes(data.copy)}\`)">复制</button>
      </div>
    `;
  } else if (data.type === 'both' || (data.imageUrl && data.copy)) {
    card.dataset.status = 'done';
    const header = card.querySelector('.task-header');
    const typeSpan = header.querySelector('.task-type');
    if (typeSpan) typeSpan.textContent = '图文';
    
    const copyPreview = (data.copy || '').substring(0, 100) + (data.copy && data.copy.length > 100 ? '...' : '');
    const imageUrls = Array.isArray(data.imageUrls) && data.imageUrls.length ? data.imageUrls : [data.imageUrl].filter(Boolean);
    const imageHtml = imageUrls.map(url => protectedImageHtml(url, '生成的图片', 'task-image', 'max-height:180px;')).join('');
    const encodedImageUrls = encodeURIComponent(JSON.stringify(imageUrls));
    const downloadButtons = imageUrls.length
      ? `<button class="task-btn" onclick="downloadImagesFromEncoded('${encodedImageUrls}')">${imageUrls.length > 1 ? '下载全部图片' : '下载图片'}</button>`
      : '';
    body.innerHTML = `
      ${imageHtml ? `<div class="task-image-grid">${imageHtml}</div>` : ''}
      <div class="xhs-task-state"><span class="task-type">完成</span></div>
      <div class="task-copy" style="font-size:13px;margin-top:8px;">${escapeHtml(copyPreview)}</div>
      <div class="task-meta">${escapeHtml(data.ratio || '1:1')} · ${imageUrls.length} 张 · ${escapeHtml(data.createdAt || '')}</div>
      <div class="task-actions">
        ${downloadButtons}
        <button class="task-btn" onclick="copyText(this, \`${escapeQuotes(data.copy || '')}\`)">复制文案</button>
      </div>
    `;
  }
  hydrateProtectedImages(body);
  forgetPendingTask(taskId);
  updateXhsWorkStats();
  updateXhsHistoryView(document.querySelector('.xhs-tool-tab.active')?.dataset.xhsTool || 'image');
}

function escapeForAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function removeTask(taskId) {
  const card = document.getElementById(taskId);
  if (card) {
    card.remove();
    activeTasks = activeTasks.filter(id => id !== taskId);
  }
  forgetPendingTask(taskId);
  
  const tasksSection = document.getElementById('tasksSection');
  const tasksGrid = document.getElementById('tasksGrid');
  if (tasksGrid.children.length === 0) {
    tasksSection.style.display = 'none';
  }
  updateXhsWorkStats();
}

window.removeTask = removeTask;

function escapeQuotes(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

function escapeJsString(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function downloadImage(url, prompt = '', ratio = 'image') {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const promptShort = prompt ? String(prompt).substring(0, 10).replace(/[^\w]/g, '_') : 'image';
  const ext = String(url || '').includes('.jpg') || String(url || '').includes('jpeg') ? 'jpg' : 'png';
  const filename = prompt || ratio !== 'image'
    ? `xhs_${ratio}_${promptShort}_${date}.${ext}`
    : `xiaohongshu_${Date.now()}.${ext}`;
  try {
    const blob = await fetchImageBlob(url);
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (err) {
    alert(err.message || '图片下载失败，请重新登录后再试');
  }
}

window.downloadImage = downloadImage;

function copyText(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = '复制'; }, 2000);
  });
}

window.copyText = copyText;

// 鎸夐挳鐘舵€佹洿鏂?
function updateButtonState(btnId, disabled, text) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = disabled;
  const span = btn.querySelector('span');
  if (span) span.textContent = text;
}

// HTML杞箟鍑芥暟锛堥槻XSS锛?
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function downloadImages(urls, prompt = '', ratio = 'image') {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  list.forEach((url, index) => {
    setTimeout(() => {
      const suffix = list.length > 1 ? `${ratio || 'image'}_${index + 1}` : ratio;
      window.downloadImage(url, prompt, suffix);
    }, index * 200);
  });
}

function downloadImagesFromEncoded(encodedUrls, prompt = '', ratio = 'image') {
  try {
    downloadImages(JSON.parse(decodeURIComponent(encodedUrls)), prompt, ratio);
  } catch (err) {
    console.error('批量下载图片失败', err);
  }
}

window.downloadImages = downloadImages;
window.downloadImagesFromEncoded = downloadImagesFromEncoded;

