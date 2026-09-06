(() => {
  const $ = id => document.getElementById(id);
  const labels = { failed:'失败', partial:'部分成功', queued:'排队中', running:'运行中', done:'成功', cancelled:'已取消', unknown:'未知', paid:'已支付', pending:'待支付', closed:'已关闭', active:'正常', frozen:'冻结', banned:'封禁', recharge:'充值', consume:'消费', refund:'退款', admin_adjust:'人工调整', signup_bonus:'注册赠送', invite_bonus:'邀请奖励' };
  const esc = escapeHtml;
  const kinds = { '/generate-copy':'文案生成', '/rewrite':'文案改写', '/generate-image':'图片生成', '/generate-both':'图文生成', '/api/xi-image/reverse-prompt':'反推提示词', '/api/xi-image/polish-prompt':'提示词优化', 'xi-generate':'画面工坊生图', 'xi-edit':'画面工坊改图', image:'图片', copy:'文案', both:'图文', reverse:'反推提示词' };
  function time(value) {
    if (!value) return '—';
    const date = new Date(String(value).replace(' ','T') + (/Z$|[+-]\d{2}:\d{2}$/.test(value) ? '' : 'Z'));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  }
  let userId = 0, section = 'logs', detailPage = 1, detailRequest = 0, taskRequest = 0, detailTrigger = null;
  async function request(url) {
    const res = await authFetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '加载失败，请重试');
    return data;
  }
  function taskCard(t, showUser) {
    const matched = t.refunds.reduce((sum,row) => sum+Number(row.amount),0);
    const refundNote = Number(t.refunded) === 0 ? '任务记录暂无退款' : matched === Number(t.refunded) ? '退款流水已匹配' : '退款记录与流水未完全匹配，请核对用户流水';
    return `<article class="support-card"><p><strong>${esc(labels[t.status] || t.status)}</strong> · ${esc(t.username || '已注销用户')} · ${esc(kinds[t.kind] || t.kind)}</p>
      <p class="support-meta">任务号：${esc(t.task_id)} · 创建：${esc(time(t.created_at))}${t.finished_at ? ' · 结束：'+esc(time(t.finished_at)) : ''}</p>
      <p>原扣 ${esc(t.charged)} 积分 · 已退 ${esc(t.refunded)} 积分 · 实际消耗 ${esc(t.actualCost)} 积分</p>
      ${t.error ? `<p>失败原因：${esc(t.error)}</p>` : ''}<p>${esc(refundNote)}</p>
      ${t.refunds.length ? `<details><summary>查看关联退款流水（${t.refunds.length} 条）</summary>${t.refunds.map(r=>`<p>#${esc(r.id)} · +${esc(r.amount)} 积分 · ${esc(time(r.created_at))} · ${esc(r.description)}</p>`).join('')}</details>` : ''}
      ${showUser ? `<button class="admin-btn" data-support-user="${Number(t.user_id)}">查看用户并核对流水</button>` : ''}</article>`;
  }
  async function loadTasks(page = 1) {
    const seq = ++taskRequest;
    $('taskLoadStatus').textContent = '正在加载任务…';
    $('taskList').replaceChildren(); $('taskPager').replaceChildren();
    try {
      const params = new URLSearchParams({ page, status:$('taskStatus').value, keyword:$('taskKeyword').value.trim() });
      const data = await request('/api/admin/tasks?'+params);
      if (seq !== taskRequest) return;
      $('taskLoadStatus').textContent = `共 ${data.total} 个任务`;
      $('taskList').innerHTML = data.items.length ? data.items.map(t=>taskCard(t,true)).join('') : '<p class="admin-empty">没有符合条件的任务，请更换筛选条件。</p>';
      renderPager('taskPager', { ...data, sizes:[20], onPage:loadTasks, onLimit:()=>loadTasks(1) });
    } catch(e) { if (seq===taskRequest) $('taskLoadStatus').textContent = e.message+'，请点击查询 / 刷新。'; }
  }
  async function loadDetail(page = 1) {
    if (!userId) return;
    const seq = ++detailRequest; detailPage = page;
    $('userDetailStatus').textContent = '正在加载用户详情…';
    $('userDetailList').replaceChildren(); $('userDetailPager').replaceChildren();
    try {
      const data = await request(`/api/admin/users/${userId}/detail?section=${section}&page=${page}`);
      if (seq !== detailRequest) return;
      const u = data.user;
      $('userDetailTitle').textContent = `${u.username} · 用户 #${u.id}`;
      $('userDetailSummary').textContent = `余额 ${u.points} 积分 · ${labels[u.status] || u.status} · ${u.role === 'admin' ? '管理员' : '普通用户'} · 注册 ${time(u.created_at)} · 订单 ${data.summary.orders} 笔 · 累计已支付 ${data.summary.paidAmount} 元 · 创作记录 ${data.summary.history} 条${u.status_reason ? ' · 状态原因：'+u.status_reason : ''}`;
      $('userDetailStatus').textContent = `共 ${data.total} 条；时间均为北京时间。`;
      $('userDetailList').innerHTML = data.items.length ? data.items.map(row => {
        if (section==='tasks') return taskCard(row,false);
        let title, body;
        if (section==='logs') { title = `${labels[row.type] || row.type} · ${row.amount>0?'+':''}${row.amount} 积分 · 余额 ${row.balance}`; body = row.description || '无备注'; }
        if (section==='orders') { title = `${row.order_no} · ${labels[row.status] || row.status}`; body = `${row.amount} 元 · ${row.points} 积分 · ${row.channel} · 支付时间 ${row.paid_at ? time(row.paid_at) : '未支付'}`; }
        if (section==='history') { title = `记录 #${row.id} · ${kinds[row.sub_type || row.type] || row.sub_type || row.type} · ${row.cost_points || 0} 积分`; body = row.prompt || '该记录没有提示词'; }
        return `<article class="support-card"><p><strong>${esc(title)}</strong></p><p class="support-meta">${esc(time(row.created_at))}</p><p>${esc(body)}</p></article>`;
      }).join('') : '<p class="admin-empty">暂无该类记录。</p>';
      renderPager('userDetailPager', { ...data, sizes:[20], onPage:loadDetail, onLimit:()=>loadDetail(1) });
    } catch(e) { if(seq===detailRequest) $('userDetailStatus').textContent = e.message+'，请点击刷新明细。'; }
  }
  document.addEventListener('click', e => {
    const trigger = e.target.closest('[data-support-user]');
    if (trigger) {
      detailTrigger = trigger; userId = Number(trigger.dataset.supportUser); section = 'logs';
      document.querySelector('[data-tab="users"]').click();
      $('usersOverview').hidden = true; $('userDetail').hidden = false; $('userDetailSummary').replaceChildren(); $('userDetailTitle').textContent = '用户详情';
      document.querySelectorAll('[data-user-section]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.userSection===section)));
      $('userDetailTitle').focus(); $('userDetail').scrollIntoView({block:'start'}); loadDetail(1);
    }
    const tab = e.target.closest('[data-user-section]');
    if(tab) { section=tab.dataset.userSection; document.querySelectorAll('[data-user-section]').forEach(b=>b.setAttribute('aria-pressed',String(b===tab))); loadDetail(1); }
  });
  $('closeUserDetail').addEventListener('click',()=>{ ++detailRequest; $('userDetail').hidden=true; $('usersOverview').hidden=false; if (detailTrigger?.closest('#usersPanel')) detailTrigger.focus(); else document.querySelector('[data-tab=users]').focus(); });
  $('refreshUserDetail').addEventListener('click',()=>loadDetail(detailPage));
  document.querySelector('[data-tab="tasks"]').addEventListener('click',()=>loadTasks(1));
  $('taskFilters').addEventListener('submit',e=>{ e.preventDefault(); loadTasks(1); });
  $('taskFilters').addEventListener('reset',()=>setTimeout(()=>loadTasks(1),0));
})();
