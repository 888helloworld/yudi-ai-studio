(() => {
  const status = document.getElementById('operationsStatus');
  const list = document.getElementById('feedbackList');
  let page = 1;
  async function request(url, options = {}) {
    const response = await authFetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '请求失败');
    return data;
  }
  async function load() {
    try {
      const data = await request('/api/admin/operations');
      const rows = [...data.jobs, ...data.xi];
      const terminal = rows.filter(row => !['running','queued'].includes(row.status));
      const total = terminal.reduce((n,row) => n + row.count, 0);
      const successes = terminal.filter(row => row.status === 'done').reduce((n,row) => n + row.count, 0);
      const average = total ? terminal.reduce((n,row) => n + row.count * row.seconds,0) / total : 0;
      const node = document.getElementById('operationsSummary');
      node.textContent = `近30天：已结束 ${total} 个任务 · 完整成功率 ${total ? (successes/total*100).toFixed(1)+'%' : '暂无数据'} · 平均 ${average.toFixed(0)} 秒 · 退款 ${data.refunds} 积分 · 待处理反馈 ${data.openFeedback} 条 · 磁盘剩余 ${data.freeDiskGb.toFixed(1)} GB`;
      document.getElementById('operationsCosts').textContent = data.costs.length ? '已核对上游花费：' + data.costs.map(item => `${item.currency} ${item.amount.toFixed(2)}`).join('；') : '尚未录入上游账单，不能据此判断利润。积分不等于现金收入。';
      document.getElementById('operationsEvents').textContent = '下载 / 复用行为（非独立用户数）：' + data.events.filter(item => ['asset_download','history_reuse'].includes(item.event_name)).map(item => `${item.event_name === 'asset_download' ? '下载' : '复用'} ${item.count}`).join('；');
      const backup = data.backup;
      document.getElementById('operationsBackup').textContent = backup ? `最近备份：${backup.completedAt} · 恢复校验 ${backup.verified ? '通过' : '未通过'} · 异地副本 ${backup.mirrored ? '已同步' : '未配置'}${Date.now()-Date.parse(backup.completedAt)>36*3600000 ? ' · 已超过36小时，请检查备份任务' : ''}` : '尚无完整备份记录，请运行 npm run backup:full。';
      document.getElementById('operationsChecks').replaceChildren(...data.checks.map(check => {
        const paragraph = document.createElement('p');
        paragraph.textContent = `${check.ok ? '✓' : '待配置'} ${check.name}：${check.detail}`;
        return paragraph;
      }));
      await loadFeedback();
    } catch (error) { status.textContent = error.message; }
  }
  async function loadFeedback() {
    const data = await request('/api/admin/feedback?page=' + page);
    list.replaceChildren();
    document.getElementById('feedbackPage').textContent = `第 ${page} 页 · 共 ${data.total} 条`;
    document.getElementById('feedbackPrev').disabled = page <= 1;
    document.getElementById('feedbackNext').disabled = page * 20 >= data.total;
    for (const item of data.items) {
      const form = document.createElement('form');
      form.className = 'content-section';
      const info = document.createElement('p');
      info.style.whiteSpace = 'pre-wrap';
      info.textContent = `#${item.id} · ${item.status === 'resolved' ? '已处理' : '待处理'} · ${item.created_at}\n任务：${item.task_id || '未填写'} · 联系：${item.contact || '站内查询'}\n${item.message}`;
      const reply = document.createElement('textarea');
      reply.setAttribute('aria-label', `回复反馈 ${item.id}`);
      reply.maxLength = 2000;
      reply.required = true;
      reply.value = item.reply;
      const button = document.createElement('button');
      button.type = 'submit'; button.className = 'admin-btn'; button.textContent = '保存回复并标记已处理';
      form.append(info,reply,button);
      form.addEventListener('submit', async event => {
        event.preventDefault(); button.disabled = true;
        try {
          await request('/api/admin/feedback/' + item.id, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ reply:reply.value, status:'resolved' }) });
          status.textContent = `反馈 #${item.id} 已保存，用户可凭查询码查看。`;
          await loadFeedback();
        } catch(error) { status.textContent = error.message; } finally { button.disabled = false; }
      });
      list.append(form);
    }
    if (!data.items.length) list.textContent = '暂无反馈';
  }
  document.querySelector('[data-tab="operations"]').addEventListener('click',load);
  document.getElementById('operationsRefresh').addEventListener('click',load);
  document.getElementById('feedbackPrev').addEventListener('click',()=>{ page=Math.max(1,page-1); loadFeedback().catch(error=>status.textContent=error.message); });
  document.getElementById('feedbackNext').addEventListener('click',()=>{ page++; loadFeedback().catch(error=>status.textContent=error.message); });
  document.getElementById('providerCostForm').addEventListener('submit',async event=>{
    event.preventDefault(); const button=event.target.querySelector('button'); button.disabled=true;
    try {
      await request('/api/admin/operations/cost',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});
      status.textContent='账单金额已保存。同一天同币种再次录入会更新原值，不会重复累加。'; await load();
    } catch(error) { status.textContent=error.message; } finally { button.disabled=false; }
  });
})();
