    async function loadPointLogs(page = pointLogsPage) {
      try {
        pointLogsPage = page;
        const params = new URLSearchParams({ page: String(pointLogsPage), limit: String(pointLogsLimit) });
        const res = await authFetch(`/api/admin/point-logs?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
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
        const res = await authFetch('/api/admin/cdkeys/generate', {
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
    AdminApp.generateCdkeys = generateCdkeys;

    async function loadCdkeyStats() {
      try {
        const res = await authFetch('/api/admin/cdkeys/stats', { headers: { 'Authorization': `Bearer ${token}` } });
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
        const res = await authFetch(`/api/admin/cdkeys?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
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
            <td data-label="卡密"><span class="cdkey-code">${escapeHtml(c.code)}</span><button type="button" class="cdkey-copy-btn" data-admin-action="copy-cdkey" data-code="${escapeHtml(c.code)}">复制</button></td>
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
    AdminApp.copyCdkey = copyCdkey;

    document.getElementById('cdkeyUsedFilter').addEventListener('change', () => loadCdkeys(1));

    // 支付订单管理
    async function loadPaymentConfig() {
      try {
        const res = await authFetch('/api/admin/payment-config', { headers: { 'Authorization': `Bearer ${token}` } });
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
        const res = await authFetch('/api/admin/payment-orders/stats', { headers: { 'Authorization': `Bearer ${token}` } });
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
        const res = await authFetch(`/api/admin/payment-orders?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
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
                  <button class="admin-btn admin-btn-primary admin-btn-sm" data-admin-action="mark-payment-paid" data-order-no="${escapeHtml(o.order_no)}">确认到账</button>
                  <button class="admin-btn admin-btn-danger admin-btn-sm" data-admin-action="close-payment-order" data-order-no="${escapeHtml(o.order_no)}">关闭</button>
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
        const res = await authFetch(`/api/admin/payment-orders/${encodeURIComponent(orderNo)}/mark-paid`, {
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
    AdminApp.markPaymentPaid = markPaymentPaid;

    async function closePaymentOrder(orderNo) {
      if (!confirm(`确定关闭订单 ${orderNo}？`)) return;
      try {
        const res = await authFetch(`/api/admin/payment-orders/${encodeURIComponent(orderNo)}/close`, {
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
    AdminApp.closePaymentOrder = closePaymentOrder;
