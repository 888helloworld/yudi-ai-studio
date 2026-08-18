    const token = localStorage.getItem('token');
    const imageInput = document.getElementById('imageInput');
    const dropZone = document.getElementById('dropZone');
    const dropHint = document.getElementById('dropHint');
    const preview = document.getElementById('preview');
    const reverseBtn = document.getElementById('reverseBtn');
    const statusEl = document.getElementById('status');
    const resultEl = document.getElementById('result');
    const emptyEl = document.getElementById('empty');
    const metaEl = document.getElementById('meta');
    const reverseTemplateGrid = document.getElementById('reverseTemplateGrid');
    const reverseTemplateHint = document.getElementById('reverseTemplateHint');
    const REVERSE_TEMPLATE_HINTS = {
      general: '按主体、场景、构图、光线、色彩、材质、镜头、风格和负面词完整拆解。',
      amazon: '适合家居、清洁、服饰配件等产品主图，重点输出专业棚拍和亚马逊白底主图提示词。',
      outfit: '适合模特穿搭、电商场景图，重点拆解姿势、服装层次、材质纹理、日系氛围和白底主图要求。',
      'style-only': '只提取风格、构图、光线、色彩和商业摄影感觉，不复制人物、品牌、logo 或独特设计。',
      structured: '按主体、背景、构图、镜头、光线、颜色、材质、风格、细节和画质关键词结构化拆图。'
    };
    let selectedFile = null;
    let previewUrl = '';
    let reverseMode = 'general';

    if (!token) {
      document.getElementById('loginPrompt').classList.add('show');
    } else {
      initUser();
    }

    imageInput.addEventListener('change', () => {
      const file = imageInput.files?.[0];
      if (file) setImage(file);
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
      if (file) setImage(file);
    });

    reverseTemplateGrid.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-reverse-mode]');
      if (!btn) return;
      reverseMode = btn.dataset.reverseMode || 'general';
      reverseTemplateGrid.querySelectorAll('[data-reverse-mode]').forEach((item) => {
        item.classList.toggle('active', item === btn);
      });
      reverseTemplateHint.textContent = REVERSE_TEMPLATE_HINTS[reverseMode] || REVERSE_TEMPLATE_HINTS.general;
      setStatus(`已选择「${btn.textContent.trim()}」模板。`, 'ok');
    });

    document.addEventListener('paste', handleImagePaste);
    reverseBtn.addEventListener('click', reversePrompt);

    async function initUser() {
      try {
        const res = await fetch('/api/user/me', { headers: { 'Authorization': 'Bearer ' + token } });
        if (!res.ok) throw new Error('登录已失效');
        const user = await res.json();
        document.getElementById('navUsername').textContent = user.username || '';
        document.getElementById('navPoints').textContent = (user.points ?? 0) + ' 积分';
      } catch {
        localStorage.removeItem('token');
        document.getElementById('loginPrompt').classList.add('show');
      }
    }

    function setImage(file) {
      if (!file.type.startsWith('image/')) {
        setStatus('只能上传图片文件。', 'error');
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        setStatus('图片不能超过 5MB。', 'error');
        return false;
      }

      selectedFile = file;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(file);
      dropHint.style.display = 'none';
      preview.innerHTML = '';

      const img = document.createElement('img');
      img.src = previewUrl;
      img.alt = '上传图片预览';
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
        clearImage();
      });

      preview.append(img, name, remove);
      reverseBtn.disabled = false;
      setStatus('图片已上传，可以开始反推提示词。', 'ok');
      return true;
    }

    function handleImagePaste(event) {
      if (!isImagePasteTarget(event.target)) return;
      const file = getImageFileFromClipboard(event.clipboardData);
      if (!file) return;

      event.preventDefault();
      dropZone.classList.add('paste-ready');
      try {
        if (setImage(file)) {
          setStatus('已粘贴图片，可以开始反推提示词。', 'ok');
        }
      } finally {
        setTimeout(() => dropZone.classList.remove('paste-ready'), 450);
      }
    }

    function isImagePasteTarget(target) {
      if (!target) return false;
      return Boolean(target.closest?.('.panel'));
    }

    function getImageFileFromClipboard(clipboardData) {
      const items = Array.from(clipboardData?.items || []);
      const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
      const file = imageItem?.getAsFile();
      if (!file) return null;
      const ext = file.type === 'image/jpeg' ? 'jpg' : (file.type.split('/')[1] || 'png');
      const name = file.name || `pasted_reverse_${Date.now()}.${ext}`;
      return new File([file], name, { type: file.type || 'image/png' });
    }

    function clearImage() {
      selectedFile = null;
      imageInput.value = '';
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
      preview.innerHTML = '';
      dropHint.style.display = 'block';
      reverseBtn.disabled = true;
      setStatus('已移除图片。', '');
    }

    async function reversePrompt() {
      if (!selectedFile) {
        setStatus('请先上传图片。', 'error');
        return;
      }

      setButtonBusy(true);
      setStatus('正在使用 gpt-5.5 分析图片并反推提示词...', '');

      try {
        const form = new FormData();
        form.append('image', selectedFile, selectedFile.name || 'image.png');
        form.append('reverseMode', reverseMode || 'general');
        const res = await fetch('/api/xi-image/reverse-prompt', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token },
          body: form
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = data.detail ? '：' + data.detail : '';
          throw new Error((data.error || '反推失败') + detail);
        }
        renderResult(data);
        setStatus('反推完成。', 'ok');
      } catch (err) {
        setStatus(err.message, 'error');
      } finally {
        setButtonBusy(false);
      }
    }

    function renderResult(data) {
      resultEl.innerHTML = '';
      emptyEl.style.display = 'none';
      metaEl.style.display = 'grid';
      document.getElementById('modelName').textContent = data.model || 'gpt-5.5';
      document.getElementById('createdAt').textContent = data.createdAt || '-';

      const result = data.result;
      if (!result) {
        document.getElementById('resultTitle').textContent = 'Raw';
        addBlock('原始返回', data.raw || '', true);
        return;
      }

      document.getElementById('resultTitle').textContent = result.title || '-';
      addBlock('中文 Prompt', result.polished_prompt_zh || result.universal_prompt_zh || result.faithful_prompt_zh || '', true);
      addBlock('英文 Prompt', result.polished_prompt_en || result.universal_prompt_en || result.dalle_prompt || result.midjourney_prompt || '', true);
    }

    function addBlock(title, text, copyable) {
      if (!text) return;
      const block = document.createElement('section');
      block.className = 'prompt-block';
      const header = document.createElement('div');
      header.className = 'prompt-block-header';
      const h3 = document.createElement('h3');
      h3.textContent = title;
      header.appendChild(h3);
      if (copyable) {
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.type = 'button';
        btn.textContent = '复制';
        btn.addEventListener('click', () => copyText(btn, text));
        header.appendChild(btn);
      }
      const content = document.createElement('div');
      content.className = 'prompt-content' + (copyable ? '' : ' muted');
      content.textContent = text;
      block.append(header, content);
      resultEl.appendChild(block);
    }

    function addKeywords(keywords) {
      if (!Array.isArray(keywords) || keywords.length === 0) return;
      const block = document.createElement('section');
      block.className = 'prompt-block';
      const header = document.createElement('div');
      header.className = 'prompt-block-header';
      const h3 = document.createElement('h3');
      h3.textContent = '风格关键词';
      header.appendChild(h3);
      const row = document.createElement('div');
      row.className = 'keyword-row';
      keywords.forEach((keyword) => {
        const chip = document.createElement('span');
        chip.className = 'keyword-chip';
        chip.textContent = keyword;
        row.appendChild(chip);
      });
      block.append(header, row);
      resultEl.appendChild(block);
    }

    function copyText(btn, text) {
      navigator.clipboard.writeText(text).then(() => {
        const old = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = old; }, 1400);
      });
    }

    function setButtonBusy(busy) {
      reverseBtn.disabled = busy || !selectedFile;
      const span = reverseBtn.querySelector('span');
      if (span) span.textContent = busy ? '反推中...' : '反推提示词';
    }

    function setStatus(text, type) {
      statusEl.textContent = text || '';
      statusEl.className = 'reverse-status' + (type ? ' ' + type : '');
    }
