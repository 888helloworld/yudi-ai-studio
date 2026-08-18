function openReversePromptModal(data) {
  const body = document.createElement('div');
  const result = data?.result || {};
  const zhPrompt = result.polished_prompt_zh
    || result.universal_prompt_zh
    || result.faithful_prompt_zh
    || '';
  const enPrompt = result.polished_prompt_en
    || result.universal_prompt_en
    || result.dalle_prompt
    || result.midjourney_prompt
    || data?.raw
    || '';

  if (data?.previewUrl) {
    const preview = document.createElement('img');
    setProtectedImageSource(preview, data.previewUrl);
    preview.alt = '反推参考图';
    preview.style.cssText = 'width:100%;max-height:220px;object-fit:contain;border-radius:var(--radius-md);background:var(--bg-input);margin-bottom:14px;';
    body.appendChild(preview);
  }

  addPromptBlock(body, '中文 Prompt', zhPrompt);
  addPromptBlock(body, '英文 Prompt', enPrompt);

  if (!zhPrompt && !enPrompt) {
    const empty = document.createElement('div');
    empty.className = 'prompt-content';
    empty.textContent = '没有解析到可用 Prompt。';
    body.appendChild(empty);
  }

  showModal(result.title || '看图写 Prompt', body);
}

function addPromptBlock(targetEl, title, text) {
  if (!text) return;
  const block = document.createElement('section');
  block.className = 'prompt-block';

  const header = document.createElement('div');
  header.className = 'prompt-block-header';

  const h3 = document.createElement('h3');
  h3.textContent = title;
  header.appendChild(h3);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.type = 'button';
  copyBtn.textContent = '复制';
  copyBtn.addEventListener('click', () => {
    copyTextToClipboard(text).then(() => {
      copyBtn.textContent = '已复制';
      setTimeout(() => { copyBtn.textContent = '复制'; }, 1400);
    }).catch(() => alert('复制失败，请手动选择文本复制。'));
  });
  header.appendChild(copyBtn);

  const content = document.createElement('div');
  content.className = 'prompt-content';
  content.textContent = text;

  const actions = document.createElement('div');
  actions.className = 'prompt-block-actions';

  const useBtn = document.createElement('button');
  useBtn.className = 'prompt-use-btn';
  useBtn.type = 'button';
  useBtn.textContent = '用它生图';
  useBtn.addEventListener('click', () => usePromptForXhsImage(text, title));
  actions.appendChild(useBtn);

  block.append(header, content, actions);
  targetEl.appendChild(block);
}

function usePromptForXhsImage(text, title = 'Prompt') {
  const promptEl = document.getElementById('imgPrompt');
  if (!promptEl) return;
  if (typeof XhsTool.switchTool === 'function') XhsTool.switchTool('image', false);
  promptEl.value = text;
  const modal = document.querySelector('.modal-overlay');
  if (modal) modal.remove();
  promptEl.focus();
  promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setXhsReverseStatus(`已填入${title}，可以直接开始生成图片。`, 'ok');
}

// =============================================
// 寮圭獥
// =============================================
function showModal(title, content, editable) {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  if (editable) modal.style.width = 'min(700px, 96%)';

  const header = document.createElement('div');
  header.className = 'modal-header';

  const titleSpan = document.createElement('span');
  titleSpan.textContent = title;
  header.appendChild(titleSpan);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body';

  if (editable && typeof content === 'string') {
    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.style.cssText = 'width:100%;min-height:300px;padding:14px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px;line-height:1.8;resize:vertical;outline:none;font-family:inherit;';
    textarea.addEventListener('focus', () => { textarea.style.borderColor = 'var(--neon-pink)'; textarea.style.boxShadow = '0 0 0 3px rgba(7,193,96,0.15)'; });
    textarea.addEventListener('blur', () => { textarea.style.borderColor = ''; textarea.style.boxShadow = ''; });
    body.appendChild(textarea);

    const btnWrapper = document.createElement('div');
    btnWrapper.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:12px;';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'task-btn';
    copyBtn.textContent = '复制文案';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(textarea.value).then(() => {
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => copyBtn.textContent = '复制文案', 2000);
      });
    };

    const closeBtn2 = document.createElement('button');
    closeBtn2.className = 'task-btn';
    closeBtn2.textContent = '关闭';
    closeBtn2.onclick = () => overlay.remove();
    closeBtn2.style.cssText = 'background:var(--bg-surface);color:var(--text-secondary);';

    btnWrapper.appendChild(copyBtn);
    btnWrapper.appendChild(closeBtn2);
    body.appendChild(btnWrapper);
  } else if (typeof content === 'string') {
    body.textContent = content;
  } else if (content instanceof Node) {
    body.appendChild(content);
  }

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

XhsTool.showModal = showModal;
