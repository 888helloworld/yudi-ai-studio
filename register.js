    const form = document.getElementById('registerForm');
    const errorEl = document.getElementById('error');
    const successEl = document.getElementById('success');
    const submitBtn = document.getElementById('submitBtn');
    const inviteInput = document.getElementById('inviteCode');
    const inviteGroup = document.getElementById('inviteGroup');
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
      } catch {
        inviteRequired = true;
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

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, inviteCode })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '注册失败');

        successEl.textContent = '注册成功，新用户积分已到账，即将跳转到登录页...';
        successEl.style.display = 'block';
        submitBtn.textContent = '注册成功';

        setTimeout(() => {
          window.location.href = safeNextPage
            ? `login.html?next=${encodeURIComponent(safeNextPage)}`
            : 'login.html';
        }, 1500);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = '注册';
      }
    });
