    const analytics = (() => {
      const storageKey = 'xhs_privacy_events_v1';
      const allowedEvents = new Set(['signup_config_loaded', 'signup_submit', 'signup_failed']);
      const allowedProperties = new Set(['invite_required', 'invite_code_present', 'policy_version', 'error_code']);
      const readQueue = () => {
        try {
          const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
          return Array.isArray(value) ? value : [];
        } catch { return []; }
      };
      const track = (name, properties = {}) => {
        if (!allowedEvents.has(name)) return false;
        const cleaned = {};
        Object.entries(properties).forEach(([key, value]) => {
          if (!allowedProperties.has(key) || !['string', 'number', 'boolean'].includes(typeof value)) return;
          cleaned[key] = typeof value === 'string' ? value.slice(0, 80) : value;
        });
        const event = { name, occurred_at: new Date().toISOString(), page: 'register', properties: cleaned };
        const endpoint = document.querySelector('meta[name="xhs-analytics-endpoint"]')?.content?.trim() || '';
        if (endpoint && navigator.sendBeacon) {
          const sent = navigator.sendBeacon(endpoint, new Blob([JSON.stringify(event)], { type: 'application/json' }));
          if (sent) return true;
        }
        try {
          localStorage.setItem(storageKey, JSON.stringify([...readQueue(), event].slice(-100)));
        } catch {}
        return true;
      };
      const api = Object.freeze({ track });
      window.XhsPrivacyAnalytics = api;
      return api;
    })();

    const form = document.getElementById('registerForm');
    const errorEl = document.getElementById('error');
    const successEl = document.getElementById('success');
    const submitBtn = document.getElementById('submitBtn');
    const inviteInput = document.getElementById('inviteCode');
    const inviteGroup = document.getElementById('inviteGroup');
    const policyConsent = document.getElementById('policyConsent');
    const POLICY_VERSION = '2026-08-26-v1';
    let inviteRequired = true;

    const searchParams = new URLSearchParams(window.location.search);
    const inviteFromUrl = searchParams.get('invite');
    const nextPage = searchParams.get('next');
    const safeNextPage = /^[a-zA-Z0-9_-]+\.html$/.test(nextPage || '') ? nextPage : '';
    document.getElementById('loginLink').href = safeNextPage
      ? `login.html?next=${encodeURIComponent(safeNextPage)}`
      : 'login.html';
    if (inviteFromUrl) {
      inviteInput.value = inviteFromUrl.trim().toUpperCase();
    }

    async function loadRegisterConfig() {
      try {
        const res = await fetch('/api/auth/register-config');
        const data = await res.json();
        inviteRequired = data.inviteRequired !== false;
        analytics?.track('signup_config_loaded', { invite_required: inviteRequired, policy_version: POLICY_VERSION });
      } catch {
        inviteRequired = true;
        analytics?.track('signup_config_loaded', { invite_required: true, policy_version: POLICY_VERSION, error_code: 'config_unavailable' });
      }
      inviteInput.required = inviteRequired;
      inviteGroup.style.display = inviteRequired ? '' : 'none';
    }

    loadRegisterConfig();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';
      successEl.style.display = 'none';

      const inviteCode = document.getElementById('inviteCode').value.trim();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirmPassword').value;

      if (!policyConsent.checked) {
        errorEl.textContent = '请先阅读并同意服务条款、隐私政策和内容规范';
        errorEl.style.display = 'block';
        return;
      }

      if (inviteRequired && !inviteCode) {
        errorEl.textContent = '请输入邀请码';
        errorEl.style.display = 'block';
        return;
      }

      if (password !== confirmPassword) {
        errorEl.textContent = '两次密码输入不一致';
        errorEl.style.display = 'block';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = '注册中...';
      analytics?.track('signup_submit', {
        invite_code_present: Boolean(inviteCode),
        invite_required: inviteRequired,
        policy_version: POLICY_VERSION
      });

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            password,
            inviteCode,
            policyAccepted: true,
            policyVersion: POLICY_VERSION,
            policyAcceptedAt: new Date().toISOString()
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '注册失败');

        try {
          localStorage.setItem('xhs_policy_acceptance', JSON.stringify({
            version: POLICY_VERSION,
            acceptedAt: new Date().toISOString()
          }));
          localStorage.setItem('token', 'cookie');
          localStorage.setItem('user', JSON.stringify(data.user || {}));
        } catch {}
        successEl.textContent = '注册成功，新用户赠送积分已到账，即将进入工作台...';
        successEl.style.display = 'block';
        submitBtn.textContent = '注册成功';

        setTimeout(() => {
          window.location.href = safeNextPage || 'xhs.html';
        }, 1500);
      } catch (err) {
        analytics?.track('signup_failed', {
          invite_code_present: Boolean(inviteCode),
          policy_version: POLICY_VERSION,
          error_code: 'register_rejected'
        });
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = '注册';
      }
    });
