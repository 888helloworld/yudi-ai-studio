    const AdminApp = window.AdminApp = window.AdminApp || {};
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
              <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="AdminApp.openRechargeModal(${Number(u.id)}, decodeURIComponent('${escapeJsString(encodeURIComponent(u.username || ''))}'))">充值</button>
              <button class="admin-btn admin-btn-sm" onclick="AdminApp.openResetPasswordModal(${Number(u.id)}, decodeURIComponent('${escapeJsString(encodeURIComponent(u.username || ''))}'))">改密码</button>
              ${u.role !== 'admin' ? `<button class="admin-btn admin-btn-danger admin-btn-sm" onclick="AdminApp.deleteUser(${Number(u.id)})">删除</button>` : ''}
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


    AdminApp.openRechargeModal = openRechargeModal;
    AdminApp.closeRechargeModal = closeRechargeModal;
    AdminApp.confirmRecharge = confirmRecharge;
    AdminApp.openResetPasswordModal = openResetPasswordModal;
    AdminApp.closeResetPasswordModal = closeResetPasswordModal;
    AdminApp.confirmResetPassword = confirmResetPassword;
    AdminApp.deleteUser = deleteUser;
