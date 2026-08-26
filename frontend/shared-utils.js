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
}(window));
