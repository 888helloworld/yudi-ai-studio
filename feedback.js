(() => {
  const form = document.getElementById('feedbackForm');
  const message = document.getElementById('feedbackStatus');
  const query = document.getElementById('feedbackQuery');
  form.elements.taskId.value = (new URLSearchParams(location.search).get('task') || '').slice(0, 160);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const response = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '提交失败');
      query.elements.id.value = data.id;
      query.elements.code.value = data.accessCode;
      message.textContent = `已收到反馈 #${data.id}。请保存下方查询码，回来可查看管理员回复。不要公开查询码。`;
      form.reset();
    } catch (error) { message.textContent = error.message || '网络异常，输入已保留，请稍后再试'; }
    finally { button.disabled = false; }
  });
  query.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const response = await fetch('/api/feedback/' + encodeURIComponent(query.elements.id.value), { headers: { 'X-Feedback-Code': query.elements.code.value }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '查询失败');
      message.textContent = `反馈 #${data.id} · ${data.status === 'resolved' ? '已处理' : '处理中'}：${data.reply || '管理员尚未回复，请稍后再来查看。'}`;
    } catch (error) { message.textContent = error.message; }
  });
})();
