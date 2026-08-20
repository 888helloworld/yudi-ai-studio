    async function loadAuditLogs(page = auditPage) {
      auditPage = page;
      const tbody = document.getElementById('auditLogsList');
      try {
        const params = new URLSearchParams({ page: String(auditPage), limit: String(auditLimit) });
        const res = await fetch(`/api/admin/audit-logs?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '加载失败');
        const logs = data.logs || [];
        tbody.innerHTML = logs.length ? logs.map((log) => {
          let details = String(log.details || '');
          try { details = JSON.stringify(JSON.parse(details)); } catch {}
          return `<tr>
            <td data-label="时间">${escapeHtml(log.created_at || '')}</td>
            <td data-label="管理员">${escapeHtml(log.admin_username || `#${log.admin_user_id}`)}</td>
            <td data-label="动作">${escapeHtml(log.action || '')}</td>
            <td data-label="对象">${escapeHtml([log.target_type, log.target_id].filter(Boolean).join(' #'))}</td>
            <td data-label="详情">${escapeHtml(details)}</td>
            <td data-label="IP">${escapeHtml(log.ip_address || '')}</td>
          </tr>`;
        }).join('') : '<tr><td class="admin-table-empty" colspan="6">暂无审计记录</td></tr>';
        renderPager('auditLogsPager', {
          page: Number(data.page || auditPage), limit: auditLimit, total: Number(data.total || 0),
          totalPages: Number(data.totalPages || 1), sizes: [20, 50, 100],
          onPage: loadAuditLogs,
          onLimit: (limit) => { auditLimit = limit; loadAuditLogs(1); }
        });
      } catch (error) {
        tbody.innerHTML = `<tr><td class="admin-table-empty" colspan="6">${escapeHtml(error.message || '加载失败')}</td></tr>`;
      }
    }
