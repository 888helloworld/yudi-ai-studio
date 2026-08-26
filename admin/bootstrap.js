    document.querySelectorAll('.admin-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
          t.tabIndex = -1;
        });
        document.querySelectorAll('.admin-panel').forEach(p => {
          p.classList.remove('active');
          p.hidden = true;
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        tab.tabIndex = 0;
        const panel = document.getElementById(tab.dataset.tab + 'Panel');
        panel.classList.add('active');
        panel.hidden = false;
        if (tab.dataset.tab === 'history') loadHistory();
        if (tab.dataset.tab === 'charts') loadChartData(7);
        if (tab.dataset.tab === 'pointlogs') loadPointLogs(1);
        if (tab.dataset.tab === 'cdkeys') { loadCdkeys(1); loadCdkeyStats(); }
        if (tab.dataset.tab === 'payment') { loadPaymentConfig(); loadPaymentStats(); loadPaymentOrders(1); }
        if (tab.dataset.tab === 'audit') loadAuditLogs(1);
      });
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const tabs = Array.from(document.querySelectorAll('.admin-tab'));
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        tabs[(tabs.indexOf(tab) + direction + tabs.length) % tabs.length].focus();
      });
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', keepalive: true }); } catch {}
      clearLocalAuthState();
      window.location.href = 'login.html';
    });
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-admin-action]');
      if (!trigger) return;
      const action = trigger.dataset.adminAction;
      if (action === 'chart') loadChartData(Number(trigger.dataset.days) || 7);
      else if (action === 'refresh-users') loadUsers(usersPage);
      else if (action === 'generate-cdkeys') generateCdkeys();
      else if (action === 'close-recharge') closeRechargeModal();
      else if (action === 'close-reset-password') closeResetPasswordModal();
      else if (action === 'open-recharge') openRechargeModal(Number(trigger.dataset.userId), trigger.dataset.username || '');
      else if (action === 'adjust-points') adjustUserPoints(Number(trigger.dataset.userId), trigger.dataset.username || '');
      else if (action === 'open-reset-password') openResetPasswordModal(Number(trigger.dataset.userId), trigger.dataset.username || '');
      else if (action === 'set-user-status') setUserStatus(Number(trigger.dataset.userId), trigger.dataset.status);
      else if (action === 'delete-user') deleteUser(Number(trigger.dataset.userId));
      else if (action === 'copy-cdkey') copyCdkey(trigger.dataset.code || '');
      else if (action === 'mark-payment-paid') markPaymentPaid(trigger.dataset.orderNo || '');
      else if (action === 'close-payment-order') closePaymentOrder(trigger.dataset.orderNo || '');
      else if (action === 'delete-history') deleteHistoryRecord(Number(trigger.dataset.historyId));
    });
    document.getElementById('rechargeForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      confirmRecharge();
    });
    document.getElementById('resetPasswordForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      confirmResetPassword();
    });

    function formatMoney(value) {
      const number = Number(value || 0);
      return Number.isInteger(number) ? String(number) : number.toFixed(2);
    }

    checkAdmin();
    loadStats();
    loadUsers();
