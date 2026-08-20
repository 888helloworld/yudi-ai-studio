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
        if (tab.dataset.tab === 'audit') loadAuditLogs(1);
      });
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = 'login.html';
    });

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
