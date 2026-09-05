(function exposeSharedFrontendUtilities(global) {
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  function isProtectedUploadUrl(url) {
    try {
      const parsed = new URL(String(url || ''), global.location.origin);
      return parsed.origin === global.location.origin && parsed.pathname.startsWith('/uploads/');
    } catch {
      return false;
    }
  }

  function getImageFileFromClipboard(clipboardData, basename = 'pasted_image') {
    const items = Array.from(clipboardData?.items || []);
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    const file = imageItem?.getAsFile();
    if (!file) return null;
    const extension = file.type === 'image/jpeg' ? 'jpg' : (file.type.split('/')[1] || 'png');
    const name = file.name || `${basename}_${Date.now()}.${extension}`;
    return new File([file], name, { type: file.type || 'image/png' });
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && global.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('copy failed');
  }

  function clearLocalAuthState() {
    for (const key of Object.keys(global.localStorage)) {
      if (key.startsWith('yudi_xhs_pending_tasks') || key.startsWith('yudi_draft:')) global.localStorage.removeItem(key);
    }
    global.localStorage.removeItem('token');
    global.localStorage.removeItem('user');
  }

  function redirectToLogin(next = '') {
    const current = next || global.location.pathname.split('/').pop() || '';
    const safeNext = /^[a-z0-9_-]+\.html$/i.test(current) && current !== 'login.html'
      ? `?next=${encodeURIComponent(current)}`
      : '';
    global.location.href = `login.html${safeNext}`;
  }

  async function authFetch(input, options = {}) {
    const { handleAuthExpired = true, nextPage = '', ...fetchOptions } = options;
    const token = global.localStorage.getItem('token');
    const headers = new Headers(fetchOptions.headers || {});
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    const response = await global.fetch(input, { ...fetchOptions, headers, credentials: 'same-origin' });
    if (response.status === 401 && handleAuthExpired) {
      clearLocalAuthState();
      redirectToLogin(nextPage);
    }
    return response;
  }

  const utilities = Object.freeze({
    copyTextToClipboard,
    authFetch,
    clearLocalAuthState,
    escapeHtml,
    getImageFileFromClipboard,
    isProtectedUploadUrl
  });
  global.AppUtils = utilities;
  global.copyTextToClipboard = copyTextToClipboard;
  global.authFetch = authFetch;
  global.clearLocalAuthState = clearLocalAuthState;
  global.escapeHtml = escapeHtml;
  global.getImageFileFromClipboard = getImageFileFromClipboard;
  global.isProtectedUploadUrl = isProtectedUploadUrl;
  global.trackProductEvent = (eventName) => {
    global.fetch('/api/events', { method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventName }) }).catch(() => {});
  };
  function initDrafts() {
    let user;
    try { user = JSON.parse(global.localStorage.getItem('user') || '{}'); } catch { return; }
    if (!user.id) return;
    const ids = ['imgPrompt', 'copyTopic', 'bothPrompt', 'rewriteInput', 'prompt'];
    const key = `yudi_draft:${user.id}:${global.location.pathname}`;
    const elements = ids.map(id => document.getElementById(id)).filter(Boolean);
    try {
      const saved = JSON.parse(global.localStorage.getItem(key) || '{}');
      if (Date.now() - Number(saved.at || 0) < 86400000) for (const element of elements) {
        if (!element.value && typeof saved[element.id] === 'string') element.value = saved[element.id].slice(0, 5000);
      }
    } catch {}
    const save = () => {
      // 只保存当前账号的文字草稿，不缓存密码、卡密或参考图。
      if (!global.localStorage.getItem('token')) return;
      try { global.localStorage.setItem(key, JSON.stringify({ at: Date.now(), ...Object.fromEntries(elements.map(el => [el.id, el.value.slice(0,5000)])) })); } catch {}
    };
    elements.forEach(element => element.addEventListener('input', save));
    global.addEventListener('pagehide', save);
    document.addEventListener('click', () => global.setTimeout(save, 0));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDrafts);
  else initDrafts();
}(window));
