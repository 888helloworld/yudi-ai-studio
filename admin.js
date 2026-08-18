    const token = localStorage.getItem('token');
    if (!token) window.location.href = 'login.html';

    let currentUserId = null;
    let users = [];
    let historyPage = 1;
    let historyLimit = 10;
    let pointLogsPage = 1;
    let pointLogsLimit = 10;
    let cdkeysPage = 1;
    let cdkeysLimit = 10;
    let paymentPage = 1;
    let paymentLimit = 10;

    async function checkAdmin() {
      try {
        const res = await fetch('/api/user/me', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const u = data.user || data;
        if (u.role !== 'admin') {
          alert('需要管理员权限');
          window.location.href = 'index.html';
        }
        document.getElementById('adminName').textContent = u.username;
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'login.html';
      }
    }

    async function loadStats() {
      try {
        const res = await fetch('/api/admin/stats', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        document.getElementById('totalUsers').textContent = data.totalUsers;
        document.getElementById('totalPoints').textContent = data.totalPoints;
        document.getElementById('todayCount').textContent = data.todayCount;
        document.getElementById('todayCost').textContent = data.todayCost || 0;
        document.getElementById('todayRecharge').textContent = data.todayRecharge || 0;
        document.getElementById('todayPaidRevenue').textContent = formatMoney(data.todayPaidRevenue || 0);
      } catch (err) {
        console.error('加载统计失败', err);
      }
    }

    async function loadUsers() {
      try {
        const res = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        users = data.users;
        renderUsers(users);
      } catch (err) {
        console.error('加载用户失败', err);
      }
    }

    function renderUsers(list) {
      const tbody = document.getElementById('usersList');
      tbody.innerHTML = list.map(u => `
        <tr>
          <td data-label="ID">${escapeHtml(u.id)}</td>
          <td data-label="用户名">${escapeHtml(u.username)}</td>
          <td data-label="积分">${escapeHtml(u.points)}</td>
          <td data-label="角色">${u.role === 'admin' ? '管理员' : '用户'}</td>
          <td data-label="注册时间">${escapeHtml(u.created_at)}</td>
          <td data-label="操作">
            <div class="admin-row-actions">
              <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="openRechargeModal(${Number(u.id)}, decodeURIComponent('${escapeJsString(encodeURIComponent(u.username || ''))}'))">充值</button>
              <button class="admin-btn admin-btn-sm" onclick="openResetPasswordModal(${Number(u.id)}, decodeURIComponent('${escapeJsString(encodeURIComponent(u.username || ''))}'))">改密码</button>
              ${u.role !== 'admin' ? `<button class="admin-btn admin-btn-danger admin-btn-sm" onclick="deleteUser(${Number(u.id)})">删除</button>` : ''}
            </div>
          </td>
        </tr>
      `).join('');
    }

    document.getElementById('searchUser').addEventListener('input', (e) => {
      const keyword = e.target.value.toLowerCase();
      renderUsers(users.filter(u => u.username.toLowerCase().includes(keyword)));
    });

    function openRechargeModal(userId, username) {
      currentUserId = userId;
      document.getElementById('rechargeUser').textContent = `为 ${username} 充值积分`;
      document.getElementById('rechargeAmount').value = '';
      document.getElementById('rechargeDesc').value = '';
      document.getElementById('rechargeError').style.display = 'none';
      document.getElementById('rechargeModal').style.display = 'flex';
    }

    function closeRechargeModal() {
      document.getElementById('rechargeModal').style.display = 'none';
    }

    async function confirmRecharge() {
      const amount = parseInt(document.getElementById('rechargeAmount').value, 10);
      const desc = document.getElementById('rechargeDesc').value;

      if (!amount || amount <= 0) {
        document.getElementById('rechargeError').textContent = '请输入正确的积分数量';
        document.getElementById('rechargeError').style.display = 'block';
        return;
      }

      try {
        const res = await fetch('/api/admin/users/recharge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ userId: currentUserId, amount, description: desc })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        closeRechargeModal();
        loadUsers();
        loadStats();
        alert(`充值成功！当前积分：${data.balance}`);
      } catch (err) {
        document.getElementById('rechargeError').textContent = err.message;
        document.getElementById('rechargeError').style.display = 'block';
      }
    }

    function openResetPasswordModal(userId, username) {
      currentUserId = userId;
      document.getElementById('resetPwdUser').textContent = `重置用户 ${username} 的密码`;
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
      document.getElementById('resetPwdError').style.display = 'none';
      document.getElementById('resetPasswordModal').style.display = 'flex';
    }

    function closeResetPasswordModal() {
      document.getElementById('resetPasswordModal').style.display = 'none';
    }

    async function confirmResetPassword() {
      const newPassword = document.getElementById('newPassword').value;
      const confirmPassword = document.getElementById('confirmPassword').value;

      if (!newPassword) {
        document.getElementById('resetPwdError').textContent = '请输入新密码';
        document.getElementById('resetPwdError').style.display = 'block';
        return;
      }
      if (newPassword.length < 8) {
        document.getElementById('resetPwdError').textContent = '密码长度至少8位';
        document.getElementById('resetPwdError').style.display = 'block';
        return;
      }
      if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
        document.getElementById('resetPwdError').textContent = '密码需包含大小写字母和数字';
        document.getElementById('resetPwdError').style.display = 'block';
        return;
      }
      if (newPassword !== confirmPassword) {
        document.getElementById('resetPwdError').textContent = '两次密码输入不一致';
        document.getElementById('resetPwdError').style.display = 'block';
        return;
      }

      try {
        const res = await fetch('/api/admin/users/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ userId: currentUserId, newPassword })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        closeResetPasswordModal();
        alert('密码重置成功！');
      } catch (err) {
        document.getElementById('resetPwdError').textContent = err.message;
        document.getElementById('resetPwdError').style.display = 'block';
      }
    }

    async function deleteUser(userId) {
      if (!confirm('确定要删除该用户吗？该操作不可恢复。')) return;
      try {
        const res = await fetch(`/api/admin/users/${userId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error);
        }
        loadUsers();
        loadStats();
      } catch (err) {
        alert(err.message);
      }
    }

    async function loadHistory(page = historyPage) {
      const keyword = document.getElementById('searchHistory').value;
      const type = document.getElementById('filterType').value;
      try {
        historyPage = page;
        const params = new URLSearchParams();
        if (keyword) params.append('keyword', keyword);
        if (type) params.append('type', type);
        params.append('page', String(historyPage));
        params.append('limit', String(historyLimit));
        const res = await fetch(`/api/admin/history?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        renderHistory(data.history);
        renderPager('historyPager', {
          page: Number(data.page || historyPage),
          limit: historyLimit,
          total: Number(data.total || 0),
          totalPages: Number(data.totalPages || 1),
          sizes: [10, 20, 50],
          onPage: loadHistory,
          onLimit: (limit) => { historyLimit = limit; loadHistory(1); }
        });
      } catch (err) {
        console.error('加载历史失败', err);
      }
    }

    function renderHistory(list) {
      const container = document.getElementById('historyList');
      if (list.length === 0) {
        container.innerHTML = '<div class="admin-empty">暂无记录</div>';
        return;
      }
      container.innerHTML = list.map(h => `
        <div class="admin-history-item">
          <div class="meta">
            <span>用户：${escapeHtml(h.username || '未知')}</span>
            <span>类型：${h.type === 'image' ? '图片' : (h.type === 'copy' ? '文案' : '图文')}</span>
            <span>消耗：${escapeHtml(h.cost_points || 0)} 积分</span>
            <span>时间：${escapeHtml(h.created_at)}</span>
          </div>
          <div class="content">${escapeHtml(h.content || h.prompt || h.image_url || '')}</div>
          <div style="margin-top:10px;">
            <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="deleteHistoryRecord(${Number(h.id)})">删除</button>
          </div>
        </div>
      `).join('');
    }

    async function deleteHistoryRecord(id) {
      if (!confirm('确定删除这条历史记录吗？')) return;
      try {
        const res = await fetch(`/api/admin/history/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('删除失败');
        loadHistory(historyPage);
      } catch (err) {
        alert(err.message || '删除失败');
      }
    }
    window.deleteHistoryRecord = deleteHistoryRecord;

    let historySearchTimer = null;
    document.getElementById('searchHistory').addEventListener('input', () => {
      clearTimeout(historySearchTimer);
      historySearchTimer = setTimeout(() => loadHistory(1), 250);
    });
    document.getElementById('filterType').addEventListener('change', () => loadHistory(1));

    // 图表功能
    async function loadChartData(days) {
      const container = document.getElementById('chartContainer');
      const summary = document.getElementById('chartSummary');
      container.innerHTML = '<div style="color:var(--text-muted);">加载中...</div>';
      summary.innerHTML = '';

      try {
        const res = await fetch(`/api/admin/daily-stats?days=${days}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const stats = data.stats || [];

        if (stats.length === 0) {
          container.innerHTML = '<div style="color:var(--text-muted);">暂无数据</div>';
          return;
        }

        // 构建图表
        const days_list = [...new Set(stats.map(s => s.day))];
        const imageData = days_list.map(d => {
          const img = stats.find(s => s.day === d && s.type === 'image');
          const both = stats.find(s => s.day === d && s.type === 'both');
          return (img ? img.count : 0) + (both ? both.count : 0);
        });
        const copyData = days_list.map(d => {
          const cp = stats.find(s => s.day === d && s.type === 'copy');
          const both = stats.find(s => s.day === d && s.type === 'both');
          return (cp ? cp.count : 0) + (both ? both.count : 0);
        });
        const costData = days_list.map(d => stats.filter(s => s.day === d).reduce((sum, row) => sum + (row.cost || 0), 0));

        // 用纯CSS柱状图
        const maxVal = Math.max(...imageData, ...copyData, 1);
        let chartHtml = '<div style="display:flex;align-items:flex-end;gap:8px;height:240px;padding:0 10px;">';
        days_list.forEach((day, i) => {
          const imgH = (imageData[i] / maxVal) * 200;
          const cpH = (copyData[i] / maxVal) * 200;
          const label = day.slice(5);
          chartHtml += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;height:240px;justify-content:flex-end;">
            <div style="font-size:10px;color:var(--text-muted);">${imageData[i]}</div>
            <div style="width:60%;height:${Math.max(imgH, 2)}px;background:linear-gradient(180deg,var(--neon-pink),rgba(7,193,96,0.4));border-radius:4px 4px 0 0;transition:var(--base);" title="图片: ${imageData[i]}"></div>
            <div style="width:60%;height:${Math.max(cpH, 2)}px;background:linear-gradient(180deg,var(--neon-cyan),rgba(7,193,96,0.4));border-radius:4px 4px 0 0;transition:var(--base);" title="文案: ${copyData[i]}"></div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">${label}</div>
          </div>`;
        });
        chartHtml += '</div>';
        chartHtml += '<div style="display:flex;gap:20px;justify-content:center;margin-top:12px;font-size:12px;"><span><span style="display:inline-block;width:12px;height:12px;background:var(--neon-pink);border-radius:3px;vertical-align:middle;margin-right:4px;"></span>图片</span><span><span style="display:inline-block;width:12px;height:12px;background:var(--neon-cyan);border-radius:3px;vertical-align:middle;margin-right:4px;"></span>文案</span></div>';
        container.innerHTML = chartHtml;

        // 汇总
        const totalImages = imageData.reduce((a, b) => a + b, 0);
        const totalCopies = copyData.reduce((a, b) => a + b, 0);
        const totalCost = costData.reduce((a, b) => a + b, 0);
        summary.innerHTML = `
          <div class="admin-stat-card"><div class="admin-stat-label">${days}天图片总数</div><div class="admin-stat-value" style="font-size:22px;">${totalImages}</div></div>
          <div class="admin-stat-card"><div class="admin-stat-label">${days}天文案总数</div><div class="admin-stat-value" style="font-size:22px;">${totalCopies}</div></div>
          <div class="admin-stat-card"><div class="admin-stat-label">${days}天总消耗积分</div><div class="admin-stat-value" style="font-size:22px;background:linear-gradient(135deg,var(--neon-red),var(--neon-pink));-webkit-background-clip:border-box;-webkit-text-fill-color:currentColor;background-clip:border-box;">${totalCost}</div></div>
          <div class="admin-stat-card"><div class="admin-stat-label">${days}天日均消耗</div><div class="admin-stat-value" style="font-size:22px;">${Math.round(totalCost / Math.max(days_list.length, 1))}</div></div>
        `;
      } catch (e) {
        container.innerHTML = '<div style="color:var(--neon-red);">加载失败</div>';
      }
    }
    window.loadChartData = loadChartData;

    function renderPager(containerId, config) {
      const container = document.getElementById(containerId);
      if (!container) return;
      const total = Number(config.total || 0);
      if (total === 0) {
        container.innerHTML = '';
        return;
      }
      const page = Math.max(1, Number(config.page || 1));
      const totalPages = Math.max(1, Number(config.totalPages || Math.ceil(total / config.limit)));
      const sizes = config.sizes || [10, 20, 50];
      container.innerHTML = `<div class="admin-pager">
        <div>第 ${page} / ${totalPages} 页 · 共 ${total} 条</div>
        <div class="admin-pager-actions">
          <span>每页</span>
          <select data-pager-size="${containerId}">
            ${sizes.map(size => `<option value="${size}"${Number(config.limit) === size ? ' selected' : ''}>${size} 条</option>`).join('')}
          </select>
          <button class="admin-btn admin-btn-sm" data-pager-prev="${containerId}"${page <= 1 ? ' disabled' : ''}>上一页</button>
          <button class="admin-btn admin-btn-sm" data-pager-next="${containerId}"${page >= totalPages ? ' disabled' : ''}>下一页</button>
        </div>
      </div>`;

      container.querySelector(`[data-pager-size="${containerId}"]`)?.addEventListener('change', (event) => {
        config.onLimit(Number(event.target.value));
      });
      container.querySelector(`[data-pager-prev="${containerId}"]`)?.addEventListener('click', () => {
        config.onPage(Math.max(1, page - 1));
      });
      container.querySelector(`[data-pager-next="${containerId}"]`)?.addEventListener('click', () => {
        config.onPage(Math.min(totalPages, page + 1));
      });
    }

    // 积分流水
    async function loadPointLogs(page = pointLogsPage) {
      try {
        pointLogsPage = page;
        const params = new URLSearchParams({ page: String(pointLogsPage), limit: String(pointLogsLimit) });
        const res = await fetch(`/api/admin/point-logs?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const tbody = document.getElementById('pointLogsList');
        if (!data.logs || data.logs.length === 0) {
          tbody.innerHTML = '<tr><td class="admin-table-empty" colspan="6" style="text-align:center;color:var(--text-muted);padding:40px;">暂无数据</td></tr>';
          document.getElementById('pointLogsPager').innerHTML = '';
          return;
        }
        tbody.innerHTML = data.logs.map(log => {
          const typeLabel = log.type === 'recharge' ? '充值' : '消费';
          const typeClass = log.type === 'recharge' ? 'recharge' : 'consume';
          const amountClass = log.type === 'recharge' ? 'positive' : 'negative';
          const amount = log.type === 'recharge' ? `+${log.amount}` : `${log.amount}`;
          return `<tr>
            <td data-label="时间" style="color:var(--text-muted);font-size:12px;">${escapeHtml(log.created_at)}</td>
            <td data-label="用户">${escapeHtml(log.username || '未知')}</td>
            <td data-label="类型"><span class="log-type ${typeClass}">${typeLabel}</span></td>
            <td data-label="金额" class="log-amount ${amountClass}">${escapeHtml(amount)}</td>
            <td data-label="余额">${escapeHtml(log.balance)}</td>
            <td data-label="说明" style="color:var(--text-secondary);">${escapeHtml(log.description || '-')}</td>
          </tr>`;
        }).join('');
        renderPager('pointLogsPager', {
          page: Number(data.page || pointLogsPage),
          limit: pointLogsLimit,
          total: Number(data.total || 0),
          totalPages: Number(data.totalPages || 1),
          sizes: [10, 20, 50, 100],
          onPage: loadPointLogs,
          onLimit: (limit) => { pointLogsLimit = limit; loadPointLogs(1); }
        });
      } catch (e) {
        document.getElementById('pointLogsList').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neon-red);padding:40px;">加载失败</td></tr>';
      }
    }

    // 卡密管理
    async function generateCdkeys() {
      const count = parseInt(document.getElementById('cdkeyCount').value, 10);
      const points = parseInt(document.getElementById('cdkeyPoints').value, 10);
      if (!count || count < 1 || count > 100) { alert('数量范围 1-100'); return; }
      if (!points || points < 10 || points > 100000) { alert('积分范围 10-100000'); return; }
      try {
        const res = await fetch('/api/admin/cdkeys/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ count, points })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        alert(`成功生成 ${data.keys.length} 张卡密`);
        loadCdkeys(1);
        loadCdkeyStats();
      } catch (err) { alert('生成失败: ' + err.message); }
    }
    window.generateCdkeys = generateCdkeys;

    async function loadCdkeyStats() {
      try {
        const res = await fetch('/api/admin/cdkeys/stats', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        document.getElementById('cdkeyTotal').textContent = data.total || 0;
        document.getElementById('cdkeyUnused').textContent = data.unused || 0;
        document.getElementById('cdkeyUsed').textContent = data.used || 0;
        document.getElementById('cdkeyTotalPoints').textContent = data.totalPoints || 0;
      } catch (e) { console.error('加载卡密统计失败', e); }
    }

    async function loadCdkeys(page = cdkeysPage) {
      const used = document.getElementById('cdkeyUsedFilter').value;
      try {
        cdkeysPage = page;
        const params = new URLSearchParams();
        if (used) params.append('used', used);
        params.append('page', String(cdkeysPage));
        params.append('limit', String(cdkeysLimit));
        const res = await fetch(`/api/admin/cdkeys?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const tbody = document.getElementById('cdkeysList');
        const list = data.list || [];
        if (list.length === 0) {
          tbody.innerHTML = '<tr><td class="admin-table-empty" colspan="6" style="text-align:center;color:var(--text-muted);padding:40px;">暂无卡密</td></tr>';
          document.getElementById('cdkeysPager').innerHTML = '';
          return;
        }
        tbody.innerHTML = list.map(c => {
          const statusClass = c.used ? 'used' : 'unused';
          const statusLabel = c.used ? '已使用' : '未使用';
          return `<tr>
            <td data-label="卡密"><span class="cdkey-code">${escapeHtml(c.code)}</span><span class="cdkey-copy-btn" onclick="copyCdkey('${escapeJsString(c.code)}')">复制</span></td>
            <td data-label="积分">${escapeHtml(c.points)}</td>
            <td data-label="状态"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            <td data-label="使用者">${escapeHtml(c.used_by_name || '-')}</td>
            <td data-label="使用时间" style="color:var(--text-muted);font-size:12px;">${escapeHtml(c.used_at || '-')}</td>
            <td data-label="创建时间" style="color:var(--text-muted);font-size:12px;">${escapeHtml(c.created_at)}</td>
          </tr>`;
        }).join('');
        renderPager('cdkeysPager', {
          page: Number(data.page || cdkeysPage),
          limit: cdkeysLimit,
          total: Number(data.total || 0),
          totalPages: Math.ceil(Number(data.total || 0) / cdkeysLimit),
          sizes: [10, 20, 50, 100],
          onPage: loadCdkeys,
          onLimit: (limit) => { cdkeysLimit = limit; loadCdkeys(1); }
        });
      } catch (e) { console.error('加载卡密失败', e); }
    }

    function copyCdkey(code) {
      navigator.clipboard.writeText(code).then(() => {
        alert('卡密已复制: ' + code);
      }).catch(() => {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert('卡密已复制: ' + code);
      });
    }
    window.copyCdkey = copyCdkey;

    document.getElementById('cdkeyUsedFilter').addEventListener('change', () => loadCdkeys(1));

    // 支付订单管理
    async function loadPaymentConfig() {
      try {
        const res = await fetch('/api/admin/payment-config', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '加载失败');
        const configuredCount = (data.channels || []).filter(c => c.configured).length;
        document.getElementById('paymentConfigStatus').innerHTML = `
          <div class="payment-config-row"><span>支付模式</span><strong>${escapeHtml(data.modeLabel || data.provider || '-')}</strong></div>
          <div class="payment-config-row"><span>公网地址</span><span class="payment-code">${escapeHtml(data.publicBaseUrl || '-')}</span></div>
          <div class="payment-config-row"><span>模拟回调</span><span>${data.mockPaymentEnabled ? '已开启' : '已关闭'}${data.mockPaymentTokenConfigured ? '，令牌已配置' : ''}</span></div>
          <div class="payment-config-row"><span>通道配置</span><span>${configuredCount} / ${(data.channels || []).length} 个已配置</span></div>
          ${(data.channels || []).map(channel => `<div class="payment-config-row">
            <span>${escapeHtml(channel.name)}</span>
            <span>
              <span class="status-badge ${channel.configured ? 'success' : 'pending'}">${channel.configured ? '已配置' : '待配置'}</span>
              <div class="payment-code" style="margin-top:6px;">${escapeHtml(channel.callbackUrl || '-')}</div>
            </span>
          </div>`).join('')}
        `;
        document.getElementById('paymentPackages').innerHTML = (data.packages || []).map(pkg => `
          <div class="payment-config-row">
            <span>${escapeHtml(pkg.label || `${pkg.points}积分`)}</span>
            <strong>${escapeHtml(pkg.points)} 积分 / ${escapeHtml(formatMoney(pkg.price))} 元</strong>
          </div>
        `).join('') || '<div class="admin-empty" style="padding:20px;">暂无套餐</div>';
      } catch (e) {
        document.getElementById('paymentConfigStatus').innerHTML = '<div class="admin-empty" style="padding:20px;color:var(--neon-red);">支付配置加载失败</div>';
      }
    }

    async function loadPaymentStats() {
      try {
        const res = await fetch('/api/admin/payment-orders/stats', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        document.getElementById('paymentStats').innerHTML = `
          <div class="cdkey-stat"><div class="num">${escapeHtml(data.paidOrders || 0)}</div><div class="lbl">已支付订单</div></div>
          <div class="cdkey-stat"><div class="num">${escapeHtml(formatMoney(data.totalRevenue || 0))}</div><div class="lbl">累计收入</div></div>
          <div class="cdkey-stat"><div class="num">${escapeHtml(data.totalPoints || 0)}</div><div class="lbl">累计到账积分</div></div>
          <div class="cdkey-stat"><div class="num">${escapeHtml(data.todayPaidPoints || 0)}</div><div class="lbl">今日支付积分</div></div>
        `;
      } catch (e) {
        console.error('加载支付统计失败', e);
      }
    }

    async function loadPaymentOrders(page = paymentPage) {
      try {
        paymentPage = page;
        const params = new URLSearchParams({ page: String(paymentPage), limit: String(paymentLimit) });
        const res = await fetch(`/api/admin/payment-orders?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const tbody = document.getElementById('paymentOrdersList');
        if (!data.orders || data.orders.length === 0) {
          tbody.innerHTML = '<tr><td class="admin-table-empty" colspan="9" style="text-align:center;color:var(--text-muted);padding:40px;">暂无支付订单</td></tr>';
          document.getElementById('paymentOrdersPager').innerHTML = '';
          return;
        }
        tbody.innerHTML = data.orders.map(o => {
          const channelLabel = o.channel === 'alipay' ? '支付宝' : '微信支付';
          const channelClass = o.channel === 'alipay' ? 'alipay' : 'wxpay';
          const statusLabel = o.status === 'paid' ? '已支付' : (o.status === 'pending' ? '待支付' : '已关闭');
          const statusClass = o.status === 'paid' ? 'success' : (o.status === 'pending' ? 'pending' : 'failed');
          return `<tr>
            <td data-label="订单号" style="font-size:12px;font-family:monospace;">${escapeHtml(o.order_no)}</td>
            <td data-label="用户">${escapeHtml(o.username || '未知')}</td>
            <td data-label="金额" style="font-weight:700;">${escapeHtml(formatMoney(o.amount))} 元</td>
            <td data-label="积分">${escapeHtml(o.points)}</td>
            <td data-label="渠道"><span class="pay-channel-tag ${channelClass}">${channelLabel}</span></td>
            <td data-label="状态"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            <td data-label="支付时间" style="color:var(--text-muted);font-size:12px;">${escapeHtml(o.paid_at || '-')}</td>
            <td data-label="创建时间" style="color:var(--text-muted);font-size:12px;">${escapeHtml(o.created_at)}</td>
            <td data-label="操作">
              <div class="admin-row-actions">
                ${o.status === 'pending' ? `
                  <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="markPaymentPaid('${escapeJsString(o.order_no)}')">确认到账</button>
                  <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="closePaymentOrder('${escapeJsString(o.order_no)}')">关闭</button>
                ` : '<span style="color:var(--text-muted);font-size:12px;">-</span>'}
              </div>
            </td>
          </tr>`;
        }).join('');
        renderPager('paymentOrdersPager', {
          page: Number(data.page || paymentPage),
          limit: paymentLimit,
          total: Number(data.total || 0),
          totalPages: Math.ceil(Number(data.total || 0) / paymentLimit),
          sizes: [10, 20, 50, 100],
          onPage: loadPaymentOrders,
          onLimit: (limit) => { paymentLimit = limit; loadPaymentOrders(1); }
        });
      } catch (e) { console.error('加载支付订单失败', e); }
    }

    async function markPaymentPaid(orderNo) {
      const tradeNo = prompt('请输入支付平台交易号或备注', `ADMIN-${Date.now()}`);
      if (tradeNo === null) return;
      if (!confirm(`确认订单 ${orderNo} 已到账并给用户充值积分？`)) return;
      try {
        const res = await fetch(`/api/admin/payment-orders/${encodeURIComponent(orderNo)}/mark-paid`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ tradeNo })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '确认失败');
        alert(`已确认到账，用户当前余额：${data.balance}`);
        loadPaymentStats();
        loadPaymentOrders(paymentPage);
        loadStats();
        loadUsers();
      } catch (err) {
        alert(err.message || '确认失败');
      }
    }
    window.markPaymentPaid = markPaymentPaid;

    async function closePaymentOrder(orderNo) {
      if (!confirm(`确定关闭订单 ${orderNo}？`)) return;
      try {
        const res = await fetch(`/api/admin/payment-orders/${encodeURIComponent(orderNo)}/close`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '关闭失败');
        loadPaymentOrders(paymentPage);
        loadPaymentStats();
      } catch (err) {
        alert(err.message || '关闭失败');
      }
    }
    window.closePaymentOrder = closePaymentOrder;

    document.querySelectorAll('.admin-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + 'Panel').classList.add('active');
        if (tab.dataset.tab === 'history') loadHistory();
        if (tab.dataset.tab === 'charts') loadChartData(7);
        if (tab.dataset.tab === 'pointlogs') loadPointLogs(1);
        if (tab.dataset.tab === 'cdkeys') { loadCdkeys(1); loadCdkeyStats(); }
        if (tab.dataset.tab === 'payment') { loadPaymentConfig(); loadPaymentStats(); loadPaymentOrders(1); }
      });
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = 'login.html';
    });

    function escapeHtml(value) {
      const div = document.createElement('div');
      div.textContent = value == null ? '' : String(value);
      return div.innerHTML;
    }

    function escapeJsString(value) {
      return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    function formatMoney(value) {
      const number = Number(value || 0);
      return Number.isInteger(number) ? String(number) : number.toFixed(2);
    }

    checkAdmin();
    loadStats();
    loadUsers();
