    // 检测是否通过 file:// 协议打开
    if (window.location.protocol === 'file:') {
      document.getElementById('error').textContent = '请通过 http://localhost:3001/login.html 访问，不要直接打开文件。';
      document.getElementById('error').style.display = 'block';
      document.getElementById('submitBtn').disabled = true;
    }

    const form = document.getElementById('loginForm');
    const errorEl = document.getElementById('error');
    const submitBtn = document.getElementById('submitBtn');
    const requestedNext = new URLSearchParams(window.location.search).get('next');
    const safeNext = requestedNext && /^[a-z0-9_-]+\.html(?:[?#].*)?$/i.test(requestedNext) ? requestedNext : '';
    document.getElementById('registerLink').href = safeNext
      ? `register.html?next=${encodeURIComponent(safeNext)}`
      : 'register.html';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = '登录中...';

      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '登录失败');

        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        if (safeNext) {
          window.location.href = safeNext;
        } else if (data.user.role === 'admin') {
          window.location.href = 'admin.html';
        } else {
          window.location.href = 'index.html';
        }
      } catch (err) {
        if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
          errorEl.textContent = '无法连接到服务器，请确认服务已启动';
        } else {
          errorEl.textContent = err.message;
        }
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = '登录';
      }
    });
