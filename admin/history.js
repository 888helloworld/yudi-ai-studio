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
            <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="AdminApp.deleteHistoryRecord(${Number(h.id)})">删除</button>
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
    AdminApp.deleteHistoryRecord = deleteHistoryRecord;

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
    AdminApp.loadChartData = loadChartData;

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
