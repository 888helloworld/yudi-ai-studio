const token = localStorage.getItem('token');
const isXhsLanding = /(?:^|\/)xhs\.html$/i.test(window.location.pathname);
const loginUrl = isXhsLanding ? 'login.html?next=xhs.html' : 'login.html';
let currentBalance = 0;
let activePaymentPoll = null;
let activePaymentOrderNo = '';
let lastModalTrigger = null;

async function initNav() {
  if (!token) return;
  try {
    const r = await authFetch('/api/user/me', { handleAuthExpired: false });
    if (!r.ok) throw new Error();
    const d = await r.json();
    const u = d.user || d;
    document.getElementById('globalUserBar').style.display = 'flex';
    document.getElementById('guestBar').style.display = 'none';
    document.getElementById('navUsername').textContent = u.username;
    document.getElementById('navPoints').textContent = `${u.points ?? 0} 积分`;
    currentBalance = Number(u.points || 0);
    if (u.role === 'admin') document.getElementById('navAdmin').style.display = 'inline';
  } catch {
    clearLocalAuthState();
  }
}

function logout(event) {
  event?.preventDefault();
  (async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', keepalive: true }); } catch {}
    clearLocalAuthState();
    window.location.href = 'login.html';
  })();
  return false;
}

async function loadStats() {
  try {
    const r = await fetch('/api/public/stats');
    if (!r.ok) return;
    const s = await r.json();
    document.getElementById('statUsers').textContent = Number(s.totalUsers || 0).toLocaleString('zh-CN');
    document.getElementById('statImages').textContent = Number(s.totalRecords || 0).toLocaleString('zh-CN');
    document.getElementById('statCopies').textContent = Number(s.totalCopies || 0).toLocaleString('zh-CN');
  } catch {}
}

async function loadShop() {
  try {
    const r = await fetch('/api/packages');
    const d = await r.json();
    document.querySelectorAll('.payment-entry').forEach((el) => {
      el.style.display = d.paymentAvailable ? '' : 'none';
    });
    if (!d.paymentAvailable) {
      document.getElementById('shopSection').style.display = 'none';
      return;
    }
    document.getElementById('shopSection').style.display = '';
    document.getElementById('shopGrid').innerHTML = d.packages.map((p, i) =>
      '<div class="shop-card' + (i === 2 ? ' featured' : '') + '">' +
      '<span class="points-num">' + escapeHtml(p.points) + '</span>' +
      '<div class="points-label">积分</div>' +
      '<div class="price">&#165;' + escapeHtml(p.price) + ' <small>' + escapeHtml((p.price / p.points * 100).toFixed(1)) + '元/百积分</small></div>' +
      '<button class="shop-btn buy" data-shell-action="start-pay" data-points="' + Number(p.points) + '" data-price="' + Number(p.price) + '" ' + (d.paymentAvailable ? '' : 'disabled') + '>' +
      (d.paymentAvailable ? '立即购买' : '在线充值未开放') + '</button></div>'
    ).join('');
  } catch {}
}

function showRedeemModal() {
  if (!localStorage.getItem('token')) {
    window.location.href = loginUrl;
    return;
  }
  lastModalTrigger = document.activeElement;
  document.getElementById('redeemModal').classList.add('show');
  document.getElementById('cdkeyInput').value = '';
  document.getElementById('redeemError').style.display = 'none';
  document.getElementById('redeemSuccess').style.display = 'none';
  document.getElementById('redeemBtn').disabled = false;
  document.getElementById('cdkeyInput').focus();
}

function hideRedeemModal() {
  document.getElementById('redeemModal').classList.remove('show');
  lastModalTrigger?.focus?.();
}

async function redeemCdkey() {
  const code = document.getElementById('cdkeyInput').value.trim();
  if (!code) {
    document.getElementById('redeemError').textContent = '请输入卡密';
    document.getElementById('redeemError').style.display = 'block';
    return;
  }
  const btn = document.getElementById('redeemBtn');
  btn.disabled = true;
  btn.textContent = '兑换中...';
  document.getElementById('redeemError').style.display = 'none';
  document.getElementById('redeemSuccess').style.display = 'none';
  try {
    const r = await authFetch('/api/cdkey/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    document.getElementById('redeemSuccess').textContent = `兑换成功！获得 ${d.points} 积分，当前余额：${d.balance} 积分`;
    document.getElementById('redeemSuccess').style.display = 'block';
    document.getElementById('navPoints').textContent = `${d.balance} 积分`;
    currentBalance = Number(d.balance || 0);
    document.getElementById('cdkeyInput').value = '';
  } catch (err) {
    document.getElementById('redeemError').textContent = err.message;
    document.getElementById('redeemError').style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '兑换积分';
  }
}

let selectedChannel = 'alipay';
let selectedPoints = 0;
let selectedPrice = 0;

function cancelPaymentPoll() {
  if (activePaymentPoll) clearInterval(activePaymentPoll);
  activePaymentPoll = null;
  activePaymentOrderNo = '';
}

function showPayModal() {
  if (!localStorage.getItem('token')) {
    window.location.href = loginUrl;
    return;
  }
  lastModalTrigger = document.activeElement;
  document.getElementById('payModal').classList.add('show');
  document.getElementById('payStatusBar').style.display = 'none';
  document.getElementById('payQrArea').innerHTML = '<p style="color:var(--text-muted);font-size:14px;">请先选择积分套餐</p>';
}

function hidePayModal() {
  cancelPaymentPoll();
  document.getElementById('payModal').classList.remove('show');
  lastModalTrigger?.focus?.();
}

function selectChannel(channel) {
  selectedChannel = channel;
  document.querySelectorAll('.pay-channel-btn').forEach((button) => {
    const active = button.dataset.channel === channel;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', active ? 'true' : 'false');
  });
}

function startPay(points, price) {
  selectedPoints = points;
  selectedPrice = price;
  document.getElementById('payAmount').textContent = price;
  document.getElementById('payPoints').textContent = points;
  showPayModal();
  createPayment();
}

async function createPayment() {
  cancelPaymentPoll();
  document.getElementById('payStatusBar').style.display = 'flex';
  document.getElementById('payQrArea').innerHTML = `<p style="color:var(--text-muted);font-size:14px;">正在创建 ¥${escapeHtml(selectedPrice)} / ${escapeHtml(selectedPoints)} 积分订单…</p><p class="hint">当前余额：${escapeHtml(currentBalance)} 积分</p>`;
  try {
    const r = await authFetch('/api/payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ points: selectedPoints, channel: selectedChannel })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    activePaymentOrderNo = String(d.orderNo || '');
    const orderNo = activePaymentOrderNo;
    document.getElementById('payQrArea').innerHTML =
      '<img src="' + escapeHtml(d.qrCode) + '" alt="支付二维码">' +
      '<div class="hint">请使用' + (selectedChannel === 'alipay' ? '支付宝' : '微信') + '扫码支付</div>' +
      '<div class="hint" style="font-weight:700;">应付 ¥' + escapeHtml(selectedPrice) + '，到账 ' + escapeHtml(selectedPoints) + ' 积分</div>' +
      '<div class="hint" style="font-size:12px;color:var(--text-dim);margin-top:4px;">当前余额：' + escapeHtml(currentBalance) + ' 积分 · 订单号：' + escapeHtml(orderNo) + '</div>';
    let attempts = 0;
    activePaymentPoll = setInterval(async () => {
      attempts += 1;
      try {
        const sr = await authFetch(`/api/payment/status/${encodeURIComponent(orderNo)}`);
        const sd = await sr.json();
        if (activePaymentOrderNo !== orderNo) return;
        if (sd.order && sd.order.status === 'paid') {
          cancelPaymentPoll();
          document.getElementById('payStatusBar').style.display = 'none';
          document.getElementById('payQrArea').innerHTML =
            '<div style="color:var(--neon-green);font-size:48px;margin-bottom:12px;">&#x2705;</div>' +
            '<div style="color:var(--text-primary);font-weight:800;font-size:18px;margin-bottom:4px;">支付成功！</div>' +
            '<div style="color:var(--neon-cyan);font-weight:700;">支付 ¥' + escapeHtml(sd.order.amount || selectedPrice) + '，获得 ' + escapeHtml(sd.order.points) + ' 积分</div>' +
            '<div class="hint">当前余额：' + escapeHtml(sd.balance || 0) + ' 积分</div>';
          currentBalance = Number(sd.balance || 0);
          document.getElementById('navPoints').textContent = `${currentBalance} 积分`;
          return;
        }
      } catch {}
      if (attempts >= 30) {
        cancelPaymentPoll();
        document.getElementById('payStatusBar').style.display = 'none';
        document.getElementById('payQrArea').innerHTML =
          '<p style="color:var(--text-muted);font-size:14px;">支付超时，请重试</p>' +
          '<button class="shop-btn buy" style="margin-top:12px;width:auto;padding:10px 24px;" data-shell-action="payment-retry">重新支付</button>';
      }
    }, 3000);
  } catch (err) {
    document.getElementById('payStatusBar').style.display = 'none';
    document.getElementById('payQrArea').innerHTML = '<p style="color:var(--neon-red);font-size:14px;">创建订单失败：' + escapeHtml(err.message) + '</p>';
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (document.getElementById('payModal')?.classList.contains('show')) hidePayModal();
  else if (document.getElementById('redeemModal')?.classList.contains('show')) hideRedeemModal();
});
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-shell-action]');
  if (!trigger) return;
  const action = trigger.dataset.shellAction;
  event.preventDefault();
  if (action === 'redeem-open') showRedeemModal();
  else if (action === 'redeem-close') hideRedeemModal();
  else if (action === 'redeem-submit') redeemCdkey();
  else if (action === 'pay-open') showPayModal();
  else if (action === 'pay-close') hidePayModal();
  else if (action === 'select-channel') selectChannel(trigger.dataset.channel);
  else if (action === 'payment-retry') createPayment();
  else if (action === 'start-pay') startPay(Number(trigger.dataset.points), Number(trigger.dataset.price));
  else if (action === 'start-creating') startCreating();
  else if (action === 'logout') logout(event);
  else if (action === 'clear-history' && typeof window.clearAllHistory === 'function') {
    window.clearAllHistory(trigger.dataset.historyType);
  }
});
window.addEventListener('pagehide', cancelPaymentPoll);

function startCreating() {
  if (!isXhsLanding) {
    window.location.href = 'xhs.html';
    return;
  }
  if (!localStorage.getItem('token')) {
    window.location.href = loginUrl;
    return;
  }
  document.getElementById('toolSection').style.display = 'block';
  document.querySelectorAll('.hero-section,.features-section,#shopSection,#ctaSection').forEach((section) => {
    section.style.display = 'none';
  });
  if (!window._toolScriptLoaded) {
    window._toolScriptLoaded = true;
    const script = document.createElement('script');
    script.src = 'script.js?v=20260818';
    document.body.appendChild(script);
  }
}

initNav();
loadStats();
loadShop();
if (isXhsLanding) setTimeout(startCreating, 100);
