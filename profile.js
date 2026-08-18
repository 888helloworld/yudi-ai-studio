    const token = localStorage.getItem('token');
    if (!token) { window.location.href = 'login.html'; }

    const authHeaders = { 'Authorization': `Bearer ${token}` };

    let pointLogs = [];
    let logTotal = 0;
    let logPage = 1;
    let logPageSize = 10;
    let invitesLoaded = false;
    let ordersLoaded = false;

    document.getElementById('logoutBtn').addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = 'login.html';
    });

    // 加载用户统计
    async function loadStats() {
      try {
        const res = await fetch('/api/user/stats', { headers: authHeaders });
        const data = await res.json();
        if (!res.ok) {
          document.getElementById('statsContainer').innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--neon-red);padding:20px;">加载失败：' + (data.error || '未知错误') + '</div>';
          return;
        }
        document.getElementById('statBalance').textContent = data.currentPoints ?? 0;
        document.getElementById('statImages').textContent = data.totalImages ?? 0;
        document.getElementById('statCopies').textContent = data.totalCopies ?? 0;
        document.getElementById('statCost').textContent = data.totalCost ?? 0;
        document.getElementById('statRecharge').textContent = data.totalRecharge ?? 0;
      } catch (e) {
        console.error('统计加载失败:', e);
        document.getElementById('statsContainer').innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--neon-red);padding:20px;">网络错误</div>';
      }
    }

    // 加载积分明细
    async function loadLogs(page = logPage) {
      try {
        logPage = page;
        const params = new URLSearchParams({ page: String(logPage), limit: String(logPageSize) });
        const res = await fetch(`/api/user/points/logs?${params}`, { headers: authHeaders });
        const data = await res.json();
        pointLogs = data.logs || [];
        logTotal = Number(data.total || pointLogs.length);
        logPage = Number(data.page || logPage);
        renderLogs();
      } catch (e) {
        document.getElementById('logsContainer').innerHTML = '<div class="log-empty">加载失败</div>';
      }
    }

    function renderLogs() {
      const container = document.getElementById('logsContainer');
      if (!pointLogs.length) {
        container.innerHTML = '<div class="log-empty">暂无积分记录</div>';
        return;
      }

      const totalPages = Math.max(1, Math.ceil(logTotal / logPageSize));
      logPage = Math.min(Math.max(logPage, 1), totalPages);
      const pageLogs = pointLogs;

      let html = '<table class="log-table"><thead><tr><th>时间</th><th>类型</th><th>金额</th><th>说明</th></tr></thead><tbody>';
      pageLogs.forEach(log => {
        const typeLabel = log.type === 'recharge' ? '获得' : '消耗';
        const typeClass = log.type === 'recharge' ? 'recharge' : 'consume';
        const amountClass = log.type === 'recharge' ? 'positive' : 'negative';
        const amount = log.type === 'recharge' ? `+${log.amount}` : `${log.amount}`;
        html += `<tr>
          <td style="color:var(--text-muted);font-size:12px;">${escapeHtml(log.created_at)}</td>
          <td><span class="log-type ${typeClass}">${typeLabel}</span></td>
          <td class="log-amount ${amountClass}">${escapeHtml(amount)}</td>
          <td style="color:var(--text-secondary);">${escapeHtml(log.description || '-')}</td>
        </tr>`;
      });
      html += '</tbody></table>';
      html += `<div class="log-pager">
        <div class="log-pager-left">
          <label for="logPageSize">每页显示</label>
          <select id="logPageSize">
            <option value="10"${logPageSize === 10 ? ' selected' : ''}>10 条</option>
            <option value="30"${logPageSize === 30 ? ' selected' : ''}>30 条</option>
            <option value="50"${logPageSize === 50 ? ' selected' : ''}>50 条</option>
          </select>
        </div>
        <div class="log-pager-right">
          <button class="log-page-btn" id="logPrevPage" type="button"${logPage <= 1 ? ' disabled' : ''}>上一页</button>
          <span class="log-page-info">第 ${logPage} / ${totalPages} 页 · 共 ${logTotal} 条</span>
          <button class="log-page-btn" id="logNextPage" type="button"${logPage >= totalPages ? ' disabled' : ''}>下一页</button>
        </div>
      </div>`;
      container.innerHTML = html;

      document.getElementById('logPageSize')?.addEventListener('change', (event) => {
        logPageSize = Number(event.target.value) || 10;
        logPage = 1;
        loadLogs(1);
      });
      document.getElementById('logPrevPage')?.addEventListener('click', () => {
        loadLogs(Math.max(1, logPage - 1));
      });
      document.getElementById('logNextPage')?.addEventListener('click', () => {
        loadLogs(Math.min(totalPages, logPage + 1));
      });
    }

    function escapeHtml(value) {
      const div = document.createElement('div');
      div.textContent = value == null ? '' : String(value);
      return div.innerHTML;
    }

    document.querySelectorAll('.profile-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        document.querySelectorAll('.profile-tab').forEach(item => item.classList.remove('active'));
        document.querySelectorAll('.profile-tab-content').forEach(item => item.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`${tabName}Tab`)?.classList.add('active');
        if (tabName === 'invite' && !invitesLoaded) loadInvites();
        if (tabName === 'orders' && !ordersLoaded) loadOrders();
      });
    });

    async function loadMe() {
      try {
        const res = await fetch('/api/user/me', { headers: authHeaders });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '加载失败');
        const user = data.user || data;
        document.getElementById('profileUserName').textContent = user.username || '';
        document.getElementById('accountUsername').textContent = user.username || '-';
        document.getElementById('accountRole').textContent = user.role === 'admin' ? '管理员' : '普通用户';
        document.getElementById('accountCreatedAt').textContent = user.created_at || '-';
      } catch (e) {
        document.getElementById('accountUsername').textContent = '加载失败';
      }
    }

    async function loadOrders() {
      const listEl = document.getElementById('ordersList');
      try {
        const res = await fetch('/api/payment/orders', { headers: authHeaders });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '加载失败');
        ordersLoaded = true;
        renderOrders(data.orders || []);
      } catch (err) {
        listEl.innerHTML = `<div class="log-empty">${escapeHtml(err.message || '加载失败')}</div>`;
      }
    }

    function renderOrders(orders) {
      const listEl = document.getElementById('ordersList');
      if (!orders.length) {
        listEl.innerHTML = '<div class="log-empty">暂无支付订单</div>';
        return;
      }
      listEl.innerHTML = orders.map(order => {
        const statusText = order.status === 'paid' ? '已支付' : (order.status === 'pending' ? '待支付' : '已关闭');
        const channelText = order.channel === 'alipay' ? '支付宝' : (order.channel === 'wxpay' ? '微信支付' : order.channel);
        return `<div class="order-item">
          <div class="order-main">
            <div>
              <div class="order-no">${escapeHtml(order.order_no || '-')}</div>
              <div class="order-meta" style="margin-top:6px;">
                <span>${escapeHtml(channelText || '-')}</span>
                <span>${escapeHtml(order.amount || 0)} 元</span>
                <span>${escapeHtml(order.points || 0)} 积分</span>
              </div>
            </div>
            <span class="profile-badge ${escapeHtml(order.status || 'closed')}">${escapeHtml(statusText)}</span>
          </div>
          <div class="order-meta">
            <span>创建：${escapeHtml(order.created_at || '-')}</span>
            <span>支付：${escapeHtml(order.paid_at || '-')}</span>
          </div>
        </div>`;
      }).join('');
    }

    async function loadInvites() {
      const listEl = document.getElementById('inviteList');
      try {
        const res = await fetch('/api/user/invites', { headers: authHeaders });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '加载失败');
        invitesLoaded = true;
        renderInvites(data.invites || []);
      } catch (err) {
        listEl.innerHTML = `<div class="log-empty">${escapeHtml(err.message || '加载失败')}</div>`;
      }
    }

    function renderInvites(invites) {
      const listEl = document.getElementById('inviteList');
      if (!invites.length) {
        listEl.innerHTML = '<div class="log-empty">暂无邀请码</div>';
        return;
      }

      const origin = window.location.origin;
      listEl.innerHTML = invites.map(invite => {
        const link = `${origin}/register.html?invite=${encodeURIComponent(invite.code)}`;
        const used = invite.used === 1;
        const statusText = used ? `已注册${invite.used_by_name ? `：${invite.used_by_name}` : ''}` : '未使用';
        return `<div class="invite-item">
          <div class="invite-main">
            <div>
              <div class="invite-code">${escapeHtml(invite.code)}</div>
              <div class="invite-meta">创建时间：${escapeHtml(invite.created_at || '-')}</div>
            </div>
            <span class="invite-status ${used ? 'used' : 'unused'}">${escapeHtml(statusText)}</span>
          </div>
          <div class="invite-copy-row">
            <div class="invite-link" title="${escapeHtml(link)}">${escapeHtml(link)}</div>
            <button class="profile-btn secondary copy-invite-code" type="button" data-copy="${escapeHtml(invite.code)}">复制码</button>
            <button class="profile-btn secondary copy-invite-link" type="button" data-copy="${escapeHtml(link)}">复制链接</button>
          </div>
        </div>`;
      }).join('');

      document.querySelectorAll('[data-copy]').forEach(btn => {
        btn.addEventListener('click', () => copyInviteText(btn.dataset.copy, btn));
      });
    }

    async function copyInviteText(text, btn) {
      const oldText = btn.textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = oldText; }, 1200);
      } catch (e) {
        const msgEl = document.getElementById('inviteMsg');
        msgEl.textContent = '复制失败，请手动选择文本复制';
        msgEl.className = 'profile-msg error';
      }
    }

    document.getElementById('generateInviteBtn').addEventListener('click', async () => {
      const btn = document.getElementById('generateInviteBtn');
      const msgEl = document.getElementById('inviteMsg');
      msgEl.className = 'profile-msg';
      btn.disabled = true;
      btn.textContent = '生成中...';
      try {
        const res = await fetch('/api/user/invites/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '生成失败');
        msgEl.textContent = '邀请码已生成';
        msgEl.className = 'profile-msg success';
        await loadInvites();
      } catch (err) {
        msgEl.textContent = err.message;
        msgEl.className = 'profile-msg error';
      } finally {
        btn.disabled = false;
        btn.textContent = '生成邀请码';
      }
    });

    document.getElementById('redeemBtn').addEventListener('click', async () => {
      const btn = document.getElementById('redeemBtn');
      const msgEl = document.getElementById('redeemMsg');
      const codeEl = document.getElementById('redeemCode');
      const code = codeEl.value.trim();
      msgEl.className = 'profile-msg';
      if (!code) {
        msgEl.textContent = '请输入卡密兑换码';
        msgEl.className = 'profile-msg error';
        return;
      }
      btn.disabled = true;
      btn.textContent = '兑换中...';
      try {
        const res = await fetch('/api/cdkey/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '兑换失败');
        msgEl.textContent = `兑换成功，获得 ${data.points} 积分，当前余额 ${data.balance} 积分`;
        msgEl.className = 'profile-msg success';
        codeEl.value = '';
        await loadStats();
        await loadLogs(1);
      } catch (err) {
        msgEl.textContent = err.message || '兑换失败';
        msgEl.className = 'profile-msg error';
      } finally {
        btn.disabled = false;
        btn.textContent = '兑换积分';
      }
    });

    // 修改密码
    document.getElementById('changePwBtn').addEventListener('click', async () => {
      const oldPw = document.getElementById('oldPassword').value;
      const newPw = document.getElementById('newPassword').value;
      const confirmPw = document.getElementById('confirmPassword').value;
      const msgEl = document.getElementById('pwMsg');
      msgEl.className = 'profile-msg';

      if (!oldPw || !newPw) { msgEl.textContent = '请填写完整'; msgEl.className = 'profile-msg error'; return; }
      if (newPw.length < 8) { msgEl.textContent = '新密码至少8位'; msgEl.className = 'profile-msg error'; return; }
      if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPw)) { msgEl.textContent = '新密码需包含大小写字母和数字'; msgEl.className = 'profile-msg error'; return; }
      if (newPw !== confirmPw) { msgEl.textContent = '两次密码不一致'; msgEl.className = 'profile-msg error'; return; }

      try {
        const res = await fetch('/api/user/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        msgEl.textContent = '密码修改成功！';
        msgEl.className = 'profile-msg success';
        document.getElementById('oldPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
      } catch (err) {
        msgEl.textContent = err.message;
        msgEl.className = 'profile-msg error';
      }
    });

    loadMe();
    loadStats();
    loadLogs();
