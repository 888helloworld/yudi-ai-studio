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
