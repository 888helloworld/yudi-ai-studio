    const AdminApp = window.AdminApp = window.AdminApp || {};
    const token = localStorage.getItem('token');
    if (!token) window.location.href = 'login.html';

    let currentUserId = null;
    let adminModalTrigger = null;
    let users = [];
    let usersPage = 1;
    let usersLimit = 20;
    let userSearchTimer = null;
    let historyPage = 1;
    let historyLimit = 10;
    let pointLogsPage = 1;
    let pointLogsLimit = 10;
    let cdkeysPage = 1;
    let cdkeysLimit = 10;
    let paymentPage = 1;
    let paymentLimit = 10;
    let auditPage = 1;
    let auditLimit = 20;

    async function checkAdmin() {
      try {
        const res = await authFetch('/api/user/me', { headers: { 'Authorization': `Bearer ${token}` } });
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
        const res = await authFetch('/api/admin/stats', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error('统计加载失败');
        const data = await res.json();
        document.getElementById('totalUsers').textContent = data.totalUsers;
        document.getElementById('totalPoints').textContent = data.totalPoints;
        document.getElementById('todayCount').textContent = data.todayCount;
        document.getElementById('todayCost').textContent = data.todayCost || 0;
        document.getElementById('todayRecharge').textContent = data.todayRecharge || 0;
        document.getElementById('todayRefundPoints').textContent = data.todayRefundPoints || 0;
        document.getElementById('todayBonusPoints').textContent = data.todayBonusPoints || 0;
        document.getElementById('todayAdminAdjustments').textContent = data.todayAdminAdjustments || 0;
        document.getElementById('todayPaidRevenue').textContent = formatMoney(data.todayPaidRevenue || 0);
      } catch (err) {
        console.error('加载统计失败', err);
      }
    }

    async function loadUsers(page = usersPage) {
      try {
        usersPage = page;
        const params = new URLSearchParams({
          page: String(usersPage),
          limit: String(usersLimit),
          keyword: document.getElementById('searchUser')?.value.trim() || '',
          status: document.getElementById('filterUserStatus')?.value || ''
        });
        const res = await authFetch(`/api/admin/users?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error('用户列表加载失败');
        const data = await res.json();
        const totalPages = Math.max(1, Number(data.totalPages || Math.ceil(Number(data.total || 0) / usersLimit) || 1));
        if (usersPage > totalPages) return loadUsers(totalPages);
        usersPage = Number(data.page || usersPage);
        users = data.users || [];
        renderUsers(users);
        renderPager('usersPager', {
          page: Number(data.page || usersPage),
          limit: usersLimit,
          total: Number(data.total || users.length),
          totalPages,
          sizes: [10, 20, 50, 100],
          onPage: loadUsers,
          onLimit: (limit) => { usersLimit = limit; loadUsers(1); }
        });
      } catch (err) {
        console.error('加载用户失败', err);
        document.getElementById('usersList').innerHTML = '<tr><td class="admin-table-empty" colspan="7">用户列表加载失败</td></tr>';
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
          <td data-label="状态">${escapeHtml({ active: '正常', frozen: '冻结', banned: '封禁' }[u.status] || u.status || '正常')}</td>
          <td data-label="注册时间">${escapeHtml(u.created_at)}</td>
          <td data-label="操作">
            <div class="admin-row-actions">
              <button class="admin-btn admin-btn-primary admin-btn-sm" data-admin-action="open-recharge" data-user-id="${Number(u.id)}" data-username="${escapeHtml(u.username || '')}">充值</button>
              <button class="admin-btn admin-btn-sm" data-admin-action="adjust-points" data-user-id="${Number(u.id)}" data-username="${escapeHtml(u.username || '')}">增减积分</button>
              <button class="admin-btn admin-btn-sm" data-admin-action="open-reset-password" data-user-id="${Number(u.id)}" data-username="${escapeHtml(u.username || '')}">改密码</button>
              ${u.role !== 'admin' && u.status !== 'frozen' ? `<button class="admin-btn admin-btn-sm" data-admin-action="set-user-status" data-user-id="${Number(u.id)}" data-status="frozen">冻结</button>` : ''}
              ${u.role !== 'admin' && u.status !== 'banned' ? `<button class="admin-btn admin-btn-danger admin-btn-sm" data-admin-action="set-user-status" data-user-id="${Number(u.id)}" data-status="banned">封禁</button>` : ''}
              ${u.role !== 'admin' && u.status && u.status !== 'active' ? `<button class="admin-btn admin-btn-primary admin-btn-sm" data-admin-action="set-user-status" data-user-id="${Number(u.id)}" data-status="active">解禁</button>` : ''}
              ${u.role !== 'admin' ? `<button class="admin-btn admin-btn-danger admin-btn-sm" data-admin-action="delete-user" data-user-id="${Number(u.id)}">删除</button>` : ''}
            </div>
          </td>
        </tr>
      `).join('');
    }

    document.getElementById('searchUser').addEventListener('input', () => {
      clearTimeout(userSearchTimer);
      userSearchTimer = setTimeout(() => loadUsers(1), 250);
    });
    document.getElementById('filterUserStatus').addEventListener('change', () => loadUsers(1));

    async function adjustUserPoints(userId, username) {
      const rawAmount = prompt(`调整 ${username} 的积分。正数增加，负数扣减：`, '0');
      if (rawAmount === null) return;
      const amount = Number.parseInt(rawAmount, 10);
      if (!Number.isInteger(amount) || amount === 0) return alert('请输入非 0 的整数');
      const reason = prompt('请输入调整原因：', amount > 0 ? '管理员增加积分' : '管理员扣减积分');
      if (reason === null || !reason.trim()) return alert('必须填写调整原因');
      if (!confirm(`确认${amount > 0 ? '增加' : '扣减'} ${Math.abs(amount)} 积分？`)) return;
      const res = await authFetch('/api/admin/users/adjust-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId, amount, description: reason.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || '积分调整失败');
      alert(`调整成功，当前余额：${data.balance}`);
      loadUsers(usersPage);
      loadStats();
    }

    async function setUserStatus(userId, status) {
      const labels = { active: '恢复正常', frozen: '冻结', banned: '封禁' };
      const reason = status === 'active' ? '管理员恢复账户' : prompt(`请输入${labels[status]}原因：`, '管理员操作');
      if (reason === null || !String(reason).trim()) return;
      if (!confirm(`确认${labels[status]}这个用户？`)) return;
      const res = await authFetch('/api/admin/users/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId, status, reason: String(reason).trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || '状态修改失败');
      loadUsers(usersPage);
    }

    function openRechargeModal(userId, username) {
      adminModalTrigger = document.activeElement;
      currentUserId = userId;
      document.getElementById('rechargeUser').textContent = `为 ${username} 充值积分`;
      document.getElementById('rechargeAmount').value = '';
      document.getElementById('rechargeDesc').value = '';
      document.getElementById('rechargeError').style.display = 'none';
      document.getElementById('rechargeModal').style.display = 'flex';
      document.getElementById('rechargeAmount').focus();
    }

    function closeRechargeModal() {
      document.getElementById('rechargeModal').style.display = 'none';
      adminModalTrigger?.focus?.();
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
        const res = await authFetch('/api/admin/users/recharge', {
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
      adminModalTrigger = document.activeElement;
      currentUserId = userId;
      document.getElementById('resetPwdUser').textContent = `重置用户 ${username} 的密码`;
      document.getElementById('resetPasswordUsername').value = username || '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
      document.getElementById('resetPwdError').style.display = 'none';
      document.getElementById('resetPasswordModal').style.display = 'flex';
      document.getElementById('newPassword').focus();
    }

    function closeResetPasswordModal() {
      document.getElementById('resetPasswordModal').style.display = 'none';
      adminModalTrigger?.focus?.();
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
      if (newPassword.length > 128) {
        document.getElementById('resetPwdError').textContent = '密码长度不能超过128位';
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
        const res = await authFetch('/api/admin/users/reset-password', {
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
        const res = await authFetch(`/api/admin/users/${userId}`, {
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


    AdminApp.openRechargeModal = openRechargeModal;
    AdminApp.closeRechargeModal = closeRechargeModal;
    AdminApp.confirmRecharge = confirmRecharge;
    AdminApp.openResetPasswordModal = openResetPasswordModal;
    AdminApp.closeResetPasswordModal = closeResetPasswordModal;
    AdminApp.confirmResetPassword = confirmResetPassword;
    AdminApp.deleteUser = deleteUser;
    AdminApp.adjustUserPoints = adjustUserPoints;
    AdminApp.setUserStatus = setUserStatus;

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (document.getElementById('resetPasswordModal').style.display !== 'none') closeResetPasswordModal();
      else if (document.getElementById('rechargeModal').style.display !== 'none') closeRechargeModal();
    });
