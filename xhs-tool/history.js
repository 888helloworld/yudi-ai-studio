const paginationHandlers = new Map();
XhsTool.paginate = (containerId, page) => {
  const handler = paginationHandlers.get(containerId);
  if (handler) handler(page);
};

function setHeroStats(totalImages, totalCopies, totalRecords) {
  const imageEl = document.getElementById('statImageCount');
  const copyEl = document.getElementById('statCopyCount');
  const totalEl = document.getElementById('statTotalCount');
  if (imageEl) imageEl.textContent = Number(totalImages) || 0;
  if (copyEl) copyEl.textContent = Number(totalCopies) || 0;
  if (totalEl) totalEl.textContent = Number(totalRecords) || 0;
}

function updateHeroStatsFromHistory() {
  const xhsHistory = getXhsHistory();
  const totalImages = xhsHistory.reduce((sum, item) => {
    if (item.type === 'image' || item.type === 'both') return sum + getHistoryImageUrls(item).length;
    return sum;
  }, 0);
  const totalCopies = xhsHistory.filter(item => (
    item.type === 'copy' || (item.type === 'both' && getHistoryCopyContent(item))
  )).length;
  setHeroStats(totalImages, totalCopies, xhsHistory.length);
  updateXhsWorkStats();
}

function setStatText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = Number(value) || 0;
}

function updateXhsWorkStats() {
  const xhsHistory = getXhsHistory();
  const reverseHistory = typeof getReverseHistory === 'function' ? getReverseHistory() : [];
  const taskCards = Array.from(document.querySelectorAll('.task-card'));
  const running = taskCards.filter(card => card.dataset.status === 'running').length;
  const failed = taskCards.filter(card => card.dataset.status === 'failed').length;
  const doneTasks = taskCards.filter(card => card.dataset.status === 'done').length;
  const done = xhsHistory.length + reverseHistory.length + doneTasks;
  const total = done + failed;
  const images = xhsHistory.reduce((sum, item) => {
    if (item.type === 'image' || item.type === 'both') return sum + getHistoryImageUrls(item).length;
    return sum;
  }, 0);
  setStatText('xhsStatQueued', 0);
  setStatText('xhsStatRunning', running);
  setStatText('xhsStatDone', done);
  setStatText('xhsStatTotal', total);
  setStatText('xhsStatImages', images);
  setStatText('xhsStatFailed', failed);
}

async function loadUserStats() {
  if (!localStorage.getItem('token')) {
    setHeroStats(0, 0, 0);
    return;
  }
  if (serverHistory.length > 0) {
    updateHeroStatsFromHistory();
    return;
  }

  try {
    const res = await fetch('/api/user/stats', {
      headers: getAuthHeader()
    });
    if (!res.ok) throw new Error('stats request failed');
    const stats = await res.json();
    const totalImages = Number(stats.totalImages) || 0;
    const totalCopies = Number(stats.totalCopies) || 0;
    const totalBoth = Number(stats.totalBoth) || 0;
    const totalRecords = stats.totalRecords !== undefined
      ? Number(stats.totalRecords)
      : Math.max(0, totalImages + totalCopies - totalBoth);
    setHeroStats(totalImages, totalCopies, totalRecords);
  } catch (e) {
    updateHeroStatsFromHistory();
  }
}

async function loadServerHistory(options = {}) {
  if (!localStorage.getItem('token')) return;
  if (historyFetchLoading) return;

  if (options.force) {
    serverHistory = [];
    historyFetchPage = 0;
    historyFetchTotalPages = 1;
  }

  const targetPage = Math.max(1, Number(options.page) || 1);
  historyFetchLoading = true;
  try {
    while (historyFetchPage < targetPage && historyFetchPage < historyFetchTotalPages) {
      const params = new URLSearchParams({
        limit: String(HISTORY_FETCH_PAGE_SIZE),
        page: String(historyFetchPage + 1),
        excludeSubTypes: 'xi-generate,xi-edit,xi-reverse'
      });
      const res = await fetch('/api/user/history?' + params.toString(), {
        headers: getAuthHeader()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '历史记录读取失败');
      historyFetchTotalPages = Math.max(1, Number(data.totalPages) || 1);
      serverHistory = serverHistory.concat(data.history || []);
      historyFetchPage = Math.max(historyFetchPage + 1, Number(data.page) || historyFetchPage + 1);
    }

    if (options.render !== false) {
      reconcilePendingTasks();
      renderHistory();
      updateHeroStatsFromHistory();
    }
  } catch (e) {
    console.error('加载历史记录失败', e);
  } finally {
    historyFetchLoading = false;
  }
}

async function ensureHistoryPageLoaded(page) {
  const targetPage = Math.max(1, Math.ceil((page * pageSize) / HISTORY_FETCH_PAGE_SIZE));
  await loadServerHistory({ page: targetPage, render: false });
}

async function changeHistoryPage(page, setter) {
  await ensureHistoryPageLoaded(page);
  setter(page);
  renderHistory();
}

// 鐐瑰嚮鍘嗗彶璁板綍
function getHistoryId(item) {
  return Number(item?.id);
}

function getHistoryImageUrls(item) {
  const value = item?.image_url || item?.imageUrl || '';
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);

  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (err) {}
  }

  return [text];
}

function getHistoryImageUrl(item) {
  return getHistoryImageUrls(item)[0] || '';
}

function getHistoryCreatedAt(item) {
  return item?.created_at || item?.createdAt || '';
}

function getHistoryCopyContent(item) {
  return item?.content || item?.copy || '';
}

function safeParseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (err) {
    return fallback;
  }
}

function isRewriteHistory(item) {
  return item?.sub_type === 'rewrite' || item?.copyType === '改写';
}

function getHistorySourceLabel(item) {
  if (isRewriteHistory(item)) return '智能文案改写';
  if (item?.type === 'both' || item?.sub_type === 'both-copy') return '图文一体生成';
  if (item?.type === 'copy') return 'AI 文案生成';
  return '记录';
}

function getCopySummary(content) {
  return String(content || '')
    .replace(/\s+/g, ' ')
    .replace(/[#*_`~]/g, '')
    .trim()
    .slice(0, 34);
}

function isXiToolHistory(item) {
  return item?.sub_type === 'xi-generate'
    || item?.sub_type === 'xi-edit'
    || item?.sub_type === 'xi-reverse'
    || item?.type === 'reverse';
}

function getXhsHistory() {
  return serverHistory.filter(item => !isXiToolHistory(item));
}

function getReverseHistory() {
  return serverHistory.filter(item => item?.sub_type === 'xhs-reverse');
}

function getDisplayHistory() {
  return [...getXhsHistory(), ...getReverseHistory()];
}

function getReverseMeta(item) {
  return safeParseJson(item?.content, {}) || {};
}

function getReversePromptDataFromHistory(item) {
  const meta = getReverseMeta(item);
  return {
    success: true,
    model: meta.model || item?.model || '',
    result: meta.result || null,
    raw: meta.raw || '',
    historyId: getHistoryId(item),
    reverseMode: meta.reverse_mode || item?.reverseMode || 'general',
    previewUrl: meta.preview_url || item?.previewUrl || '',
    durationMs: meta.duration_ms || item?.durationMs || 0,
    createdAt: getHistoryCreatedAt(item)
  };
}

function getReversePromptSummary(item) {
  const data = item?.result ? item : getReversePromptDataFromHistory(item);
  const result = data?.result || {};
  return result.polished_prompt_zh
    || result.polished_prompt_en
    || result.universal_prompt_zh
    || result.universal_prompt_en
    || result.faithful_prompt_zh
    || result.dalle_prompt
    || result.midjourney_prompt
    || data?.raw
    || '';
}

document.addEventListener('click', (e) => {
  const card = e.target.closest('.history-card');
  if (!card) return;
  
  const id = Number(card.dataset.id);
  const item = getDisplayHistory().find(h => getHistoryId(h) === id);
  if (!item) return;
  
  if (item.type === 'reverse' || item.sub_type === 'xhs-reverse') {
    openReversePromptModal(getReversePromptDataFromHistory(item));
  } else if (item.type === 'image' && getHistoryImageUrl(item)) {
    // 图片预览弹窗：大图 + 下载按钮
    const imgUrl = getHistoryImageUrl(item);
    const body = document.createElement('div');
    body.style.cssText = 'text-align:center;';
    
    const img = document.createElement('img');
    setProtectedImageSource(img, imgUrl);
    img.alt = '历史图片';
    img.style.cssText = 'max-width:100%;max-height:65vh;border-radius:12px;display:block;margin:0 auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
    
    const btnWrapper = document.createElement('div');
    btnWrapper.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:16px;';
    
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'task-btn';
    downloadBtn.textContent = '下载图片';
    downloadBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:linear-gradient(135deg,var(--neon-pink),#059050);color:#fff;border:none;border-radius:var(--radius-md);cursor:pointer;';
    downloadBtn.onmouseover = () => { downloadBtn.style.opacity = '0.9'; };
    downloadBtn.onmouseout = () => { downloadBtn.style.opacity = '1'; };
    downloadBtn.onclick = () => downloadImage(imgUrl);
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'task-btn';
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:var(--bg-surface);border:1px solid var(--border);color:var(--text-secondary);border-radius:var(--radius-md);cursor:pointer;';
    closeBtn.onclick = () => { const m = document.querySelector('.modal-overlay'); if (m) m.remove(); };
    
    btnWrapper.appendChild(downloadBtn);
    btnWrapper.appendChild(closeBtn);
    
    body.appendChild(img);
    body.appendChild(btnWrapper);
    
    showModal(getHistoryCreatedAt(item) || '历史图片', body);
  } else if (item.type === 'copy' && getHistoryCopyContent(item)) {
    // 文案预览弹窗：直接展示完整文案 + 复制按钮
    const isRewrite = isRewriteHistory(item);
    const typeLabel = isRewrite ? '改写' : '文案';
    const content = getHistoryCopyContent(item);
    
    const body = document.createElement('div');
    
    const preview = document.createElement('div');
    preview.style.cssText = 'background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-md);padding:20px;font-size:14px;line-height:1.9;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow-y:auto;';
    preview.textContent = content;
    
    const btnWrapper = document.createElement('div');
    btnWrapper.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:16px;';
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'task-btn';
    copyBtn.textContent = '复制文案';
    copyBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:linear-gradient(135deg,var(--neon-green),#059050);color:#fff;border:none;border-radius:var(--radius-md);cursor:pointer;';
    copyBtn.onmouseover = () => { copyBtn.style.opacity = '0.9'; };
    copyBtn.onmouseout = () => { copyBtn.style.opacity = '1'; };
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(content).then(() => {
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => { copyBtn.textContent = '复制文案'; }, 2000);
      });
    };
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'task-btn';
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:var(--bg-surface);border:1px solid var(--border);color:var(--text-secondary);border-radius:var(--radius-md);cursor:pointer;';
    closeBtn.onclick = () => { const m = document.querySelector('.modal-overlay'); if (m) m.remove(); };
    
    btnWrapper.appendChild(copyBtn);
    btnWrapper.appendChild(closeBtn);
    
    body.appendChild(preview);
    body.appendChild(btnWrapper);
    
    showModal(`${typeLabel} · ${getHistoryCreatedAt(item)}`, body);
  } else if (item.type === 'both') {
    // 图文一体弹窗：多图 + 完整文案 + 下载/复制按钮
    const imageUrls = getHistoryImageUrls(item);
    const content = getHistoryCopyContent(item);
    
    const body = document.createElement('div');
    
    // 图片区域
    if (imageUrls.length) {
      const imageGrid = document.createElement('div');
      imageGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;';
      imageUrls.forEach((url, index) => {
        const img = document.createElement('img');
        setProtectedImageSource(img, url);
        img.alt = `图文一体图片 ${index + 1}`;
        img.style.cssText = 'width:100%;max-height:45vh;object-fit:cover;border-radius:12px;display:block;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
        imageGrid.appendChild(img);
      });
      body.appendChild(imageGrid);
    }
    
    // 文案区域
    if (content) {
      const preview = document.createElement('div');
      preview.style.cssText = 'background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-md);padding:20px;font-size:14px;line-height:1.9;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;max-height:40vh;overflow-y:auto;';
      preview.textContent = content;
      body.appendChild(preview);
    }
    
    const btnWrapper = document.createElement('div');
    btnWrapper.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap;';
    
    if (imageUrls.length) {
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'task-btn';
      downloadBtn.textContent = imageUrls.length > 1 ? '下载全部图片' : '下载图片';
      downloadBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:linear-gradient(135deg,var(--neon-pink),#059050);color:#fff;border:none;border-radius:var(--radius-md);cursor:pointer;';
      downloadBtn.onclick = () => downloadImages(imageUrls);
      btnWrapper.appendChild(downloadBtn);
    }
    
    if (content) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'task-btn';
      copyBtn.textContent = '复制文案';
      copyBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:linear-gradient(135deg,var(--neon-green),#059050);color:#fff;border:none;border-radius:var(--radius-md);cursor:pointer;';
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(content).then(() => {
          copyBtn.textContent = '已复制 ✓';
          setTimeout(() => { copyBtn.textContent = '复制文案'; }, 2000);
        });
      };
      btnWrapper.appendChild(copyBtn);
    }
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'task-btn';
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:var(--bg-surface);border:1px solid var(--border);color:var(--text-secondary);border-radius:var(--radius-md);cursor:pointer;';
    closeBtn.onclick = () => { const m = document.querySelector('.modal-overlay'); if (m) m.remove(); };
    btnWrapper.appendChild(closeBtn);
    
    body.appendChild(btnWrapper);
    
    showModal(`图文一体 · ${getHistoryCreatedAt(item)}`, body);
  }
});

function renderHistory() {
  const historySection = document.getElementById('historySection');
  const imageHistoryGrid = document.getElementById('imageHistoryGrid');
  const copyHistoryGrid = document.getElementById('copyHistoryGrid');
  const bothHistoryGrid = document.getElementById('bothHistoryGrid');
  const reverseHistoryGrid = document.getElementById('reverseHistoryGrid');
  const rewriteHistoryGrid = document.getElementById('rewriteHistoryGrid');
  
  const xhsHistory = getXhsHistory();
  const reverseHistory = getReverseHistory();
  if (xhsHistory.length === 0 && reverseHistory.length === 0) {
    historySection.style.display = 'none';
    return;
  }
  
  historySection.style.display = 'block';
  imageHistoryGrid.innerHTML = '';
  copyHistoryGrid.innerHTML = '';
  if (bothHistoryGrid) bothHistoryGrid.innerHTML = '';
  if (reverseHistoryGrid) reverseHistoryGrid.innerHTML = '';
  if (rewriteHistoryGrid) rewriteHistoryGrid.innerHTML = '';
  
  const imageHistory = xhsHistory.filter(item => item.type === 'image' && getHistoryImageUrl(item));
  const copyHistory = xhsHistory.filter(item => item.type === 'copy' && item.sub_type !== 'both-copy' && !isRewriteHistory(item) && getHistoryCopyContent(item));
  const rewriteHistory = xhsHistory.filter(item => item.type === 'copy' && isRewriteHistory(item) && getHistoryCopyContent(item));
  const bothHistory = xhsHistory.filter(item => item.type === 'both' || item.sub_type === 'both-copy');
  
  // 璁＄畻鍒嗛〉
  const getLoadedTotalPages = (items) => {
    const loadedPages = Math.ceil(items.length / pageSize);
    const hasMoreLoadedHistory = historyFetchPage < historyFetchTotalPages && items.length >= pageSize;
    return Math.max(loadedPages, hasMoreLoadedHistory ? loadedPages + 1 : loadedPages);
  };
  const imageTotalPages = getLoadedTotalPages(imageHistory);
  const copyTotalPages = getLoadedTotalPages(copyHistory);
  const rewriteTotalPages = getLoadedTotalPages(rewriteHistory);
  const bothTotalPages = getLoadedTotalPages(bothHistory);
  const reverseTotalPages = getLoadedTotalPages(reverseHistory);
  
  // 纭繚椤电爜鍦ㄦ湁鏁堣寖鍥村唴
  if (imagePage > imageTotalPages && imageTotalPages > 0) imagePage = imageTotalPages;
  if (copyPage > copyTotalPages && copyTotalPages > 0) copyPage = copyTotalPages;
  if (rewritePage > rewriteTotalPages && rewriteTotalPages > 0) rewritePage = rewriteTotalPages;
  if (bothPage > bothTotalPages && bothTotalPages > 0) bothPage = bothTotalPages;
  if (reversePage > reverseTotalPages && reverseTotalPages > 0) reversePage = reverseTotalPages;
  
  // 鏇存柊璁℃暟
  document.getElementById('imageCount').textContent = `共 ${imageHistory.length} 条`;
  document.getElementById('copyCount').textContent = `共 ${copyHistory.length} 条`;
  const rewriteCountEl = document.getElementById('rewriteCount');
  if (rewriteCountEl) rewriteCountEl.textContent = `共 ${rewriteHistory.length} 条`;
  const bothCountEl = document.getElementById('bothCount');
  if (bothCountEl) bothCountEl.textContent = `共 ${bothHistory.length} 条`;
  const reverseCountEl = document.getElementById('reverseCount');
  if (reverseCountEl) reverseCountEl.textContent = `共 ${reverseHistory.length} 条`;
  
  const imageStart = (imagePage - 1) * pageSize;
  const imageEnd = imageStart + pageSize;
  imageHistory.slice(imageStart, imageEnd).forEach(item => {
    const card = createHistoryCard(item);
    imageHistoryGrid.appendChild(card);
  });
  
  const copyStart = (copyPage - 1) * pageSize;
  const copyEnd = copyStart + pageSize;
  copyHistory.slice(copyStart, copyEnd).forEach(item => {
    const card = createHistoryCard(item);
    copyHistoryGrid.appendChild(card);
  });

  const rewriteStart = (rewritePage - 1) * pageSize;
  const rewriteEnd = rewriteStart + pageSize;
  rewriteHistory.slice(rewriteStart, rewriteEnd).forEach(item => {
    const card = createHistoryCard(item);
    if (rewriteHistoryGrid) rewriteHistoryGrid.appendChild(card);
  });
  
  const bothStart = (bothPage - 1) * pageSize;
  const bothEnd = bothStart + pageSize;
  bothHistory.slice(bothStart, bothEnd).forEach(item => {
    const card = createHistoryCard(item);
    if (bothHistoryGrid) bothHistoryGrid.appendChild(card);
  });

  const reverseStart = (reversePage - 1) * pageSize;
  const reverseEnd = reverseStart + pageSize;
  reverseHistory.slice(reverseStart, reverseEnd).forEach(item => {
    const card = createHistoryCard(item);
    if (reverseHistoryGrid) reverseHistoryGrid.appendChild(card);
  });
  
  // 娓叉煋鍒嗛〉鎺т欢
  renderPagination('imagePagination', imagePage, imageTotalPages, imageHistory.length, (page) => {
    changeHistoryPage(page, (nextPage) => { imagePage = nextPage; });
  });
  
  renderPagination('copyPagination', copyPage, copyTotalPages, copyHistory.length, (page) => {
    changeHistoryPage(page, (nextPage) => { copyPage = nextPage; });
  });

  const rewritePagination = document.getElementById('rewritePagination');
  if (rewritePagination) {
    renderPagination('rewritePagination', rewritePage, rewriteTotalPages, rewriteHistory.length, (page) => {
      changeHistoryPage(page, (nextPage) => { rewritePage = nextPage; });
    });
  }
  
  const bothPagination = document.getElementById('bothPagination');
  if (bothPagination) {
    renderPagination('bothPagination', bothPage, bothTotalPages, bothHistory.length, (page) => {
      changeHistoryPage(page, (nextPage) => { bothPage = nextPage; });
    });
  }

  const reversePagination = document.getElementById('reversePagination');
  if (reversePagination) {
    renderPagination('reversePagination', reversePage, reverseTotalPages, reverseHistory.length, (page) => {
      changeHistoryPage(page, (nextPage) => { reversePage = nextPage; });
    });
  }
  updateXhsHistoryView(document.querySelector('.xhs-tool-tab.active')?.dataset.xhsTool || 'image');
}

function createHistoryCard(item) {
  const card = document.createElement('div');
  card.className = 'history-card';
  card.dataset.id = getHistoryId(item);
  
  if (item.type === 'reverse' || item.sub_type === 'xhs-reverse') {
    const meta = getReverseMeta(item);
    const previewUrl = meta.preview_url || item.previewUrl || '';
    const summary = getReversePromptSummary(item);
    const thumb = previewUrl
      ? document.createElement('img')
      : document.createElement('div');

    if (previewUrl) {
      setProtectedImageSource(thumb, previewUrl);
      thumb.alt = '反推参考图';
    } else {
      thumb.className = 'copy-thumb';
      thumb.textContent = 'P';
    }

    const infoDiv = document.createElement('div');
    infoDiv.className = 'history-info';

    const typeSpan = document.createElement('span');
    typeSpan.className = 'history-type copy-type';
    typeSpan.textContent = '看图写 Prompt';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'history-date';
    dateSpan.textContent = getHistoryCreatedAt(item);

    infoDiv.appendChild(typeSpan);
    infoDiv.appendChild(dateSpan);

    if (item.prompt) {
      const title = document.createElement('p');
      title.className = 'history-title-text';
      title.textContent = item.prompt.length > 18 ? item.prompt.substring(0, 18) + '...' : item.prompt;
      title.title = item.prompt;
      infoDiv.appendChild(title);
    }

    if (summary) {
      const summaryP = document.createElement('p');
      summaryP.className = 'history-copy-summary';
      summaryP.textContent = getCopySummary(summary);
      summaryP.title = summary;
      infoDiv.appendChild(summaryP);
    }

    card.appendChild(thumb);
    card.appendChild(infoDiv);
  } else if (item.type === 'image' && getHistoryImageUrl(item)) {
    const img = document.createElement('img');
    setProtectedImageSource(img, getHistoryImageUrl(item));
    img.alt = '历史图片';
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'history-info';
    
    const typeSpan = document.createElement('span');
    typeSpan.className = 'history-type';
    typeSpan.textContent = item.ratio || '1:1';
    
    const dateSpan = document.createElement('span');
    dateSpan.className = 'history-date';
    dateSpan.textContent = getHistoryCreatedAt(item);
    
    infoDiv.appendChild(typeSpan);
    infoDiv.appendChild(dateSpan);
    
    if (item.prompt) {
      const p = document.createElement('p');
      p.className = 'history-info-text';
      p.textContent = item.prompt.substring(0, 20) + '...';
      p.title = item.prompt;
      infoDiv.appendChild(p);
    }
    
    card.appendChild(img);
    card.appendChild(infoDiv);
    
  } else if (item.type === 'copy' && getHistoryCopyContent(item)) {
    const isRewrite = isRewriteHistory(item);
    const typeLabel = getHistorySourceLabel(item);
    const content = getHistoryCopyContent(item);
    
    const thumbDiv = document.createElement('div');
    thumbDiv.className = 'copy-thumb' + (isRewrite ? ' rewrite' : '');
    thumbDiv.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>`;
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'history-info';
    
    const typeSpan = document.createElement('span');
    typeSpan.className = 'history-type copy-type' + (isRewrite ? ' rewrite-type' : '');
    typeSpan.textContent = typeLabel;
    
    const dateSpan = document.createElement('span');
    dateSpan.className = 'history-date';
    dateSpan.textContent = getHistoryCreatedAt(item);
    
    infoDiv.appendChild(typeSpan);
    infoDiv.appendChild(dateSpan);
    
    if (item.prompt) {
      const p = document.createElement('p');
      p.className = 'history-title-text';
      p.textContent = item.prompt.length > 18 ? item.prompt.substring(0, 18) + '...' : item.prompt;
      p.title = item.prompt;
      infoDiv.appendChild(p);
    }

    const summary = getCopySummary(content);
    if (summary) {
      const summaryP = document.createElement('p');
      summaryP.className = 'history-copy-summary';
      summaryP.textContent = summary;
      summaryP.title = content;
      infoDiv.appendChild(summaryP);
    }
    
    card.appendChild(thumbDiv);
    card.appendChild(infoDiv);
    
  } else if (item.type === 'both') {
    // 图文一体卡片：小图 + 文案摘要
    const imageUrls = getHistoryImageUrls(item);
    const imgUrl = imageUrls[0] || '';
    const content = getHistoryCopyContent(item);
    
    const img = document.createElement('img');
    if (imgUrl) setProtectedImageSource(img, imgUrl);
    img.alt = '图文一体';
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'history-info';
    
    const typeSpan = document.createElement('span');
    typeSpan.className = 'history-type both-type';
    typeSpan.textContent = imageUrls.length > 1 ? `图文一体生成 · ${imageUrls.length}图` : '图文一体生成';
    
    const dateSpan = document.createElement('span');
    dateSpan.className = 'history-date';
    dateSpan.textContent = getHistoryCreatedAt(item);
    
    infoDiv.appendChild(typeSpan);
    infoDiv.appendChild(dateSpan);
    
    if (item.prompt) {
      const p = document.createElement('p');
      p.className = 'history-title-text';
      p.textContent = item.prompt.length > 18 ? item.prompt.substring(0, 18) + '...' : item.prompt;
      p.title = item.prompt;
      infoDiv.appendChild(p);
    }
    
    card.appendChild(img);
    card.appendChild(infoDiv);
  }
  
  return card;
}

function renderPagination(containerId, currentPage, totalPages, totalItems, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  
  let html = '';
  
  // 涓婁竴椤?
  html += `<button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="XhsTool.paginate('${containerId}', ${currentPage - 1})">上一页</button>`;
  
  // 椤电爜
  html += '<div class="pagination-pages">';
  const maxVisible = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  
  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }
  
  if (startPage > 1) {
    html += `<button class="pagination-btn" onclick="XhsTool.paginate('${containerId}', 1)">1</button>`;
    if (startPage > 2) html += '<span class="pagination-info">...</span>';
  }
  
  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="XhsTool.paginate('${containerId}', ${i})">${i}</button>`;
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += '<span class="pagination-info">...</span>';
    html += `<button class="pagination-btn" onclick="XhsTool.paginate('${containerId}', ${totalPages})">${totalPages}</button>`;
  }
  html += '</div>';
  
  // 涓嬩竴椤?
  html += `<button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="XhsTool.paginate('${containerId}', ${currentPage + 1})">下一页</button>`;
  
  // 淇℃伅
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  html += `<span class="pagination-info">${start}-${end} / ${totalItems}</span>`;
  
  container.innerHTML = html;
  
  paginationHandlers.set(containerId, onPageChange);
}

function initPagination() {
  const select = document.getElementById('pageSizeSelect');
  select.addEventListener('change', async () => {
    pageSize = parseInt(select.value);
    imagePage = 1;
    copyPage = 1;
    bothPage = 1;
    reversePage = 1;
    await ensureHistoryPageLoaded(1);
    renderHistory();
  });
}
