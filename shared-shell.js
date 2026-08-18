const token = localStorage.getItem('token');
const isXhsLanding = /(?:^|\/)xhs\.html$/i.test(window.location.pathname);
const loginUrl = isXhsLanding ? 'login.html?next=xhs.html' : 'login.html';

async function initNav() {
  if (!token) return;
  try {
    const r = await fetch('/api/user/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error();
    const d = await r.json();
    const u = d.user || d;
    document.getElementById('globalUserBar').style.display = 'flex';
    document.getElementById('guestBar').style.display = 'none';
    document.getElementById('navUsername').textContent = u.username;
    document.getElementById('navPoints').textContent = `${u.points ?? 0} 积分`;
    if (u.role === 'admin') document.getElementById('navAdmin').style.display = 'inline';
  } catch {
    localStorage.removeItem('token');
  }
}

function logout() {
  localStorage.removeItem('token');
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
      '<button class="shop-btn buy" ' + (d.paymentAvailable ? 'onclick="startPay(' + Number(p.points) + ',' + Number(p.price) + ')"' : 'disabled') + '>' +
      (d.paymentAvailable ? '立即购买' : '在线充值未开放') + '</button></div>'
    ).join('');
  } catch {}
}

function showRedeemModal() {
  if (!localStorage.getItem('token')) {
    window.location.href = loginUrl;
    return;
  }
  document.getElementById('redeemModal').classList.add('show');
  document.getElementById('cdkeyInput').value = '';
  document.getElementById('redeemError').style.display = 'none';
  document.getElementById('redeemSuccess').style.display = 'none';
  document.getElementById('redeemBtn').disabled = false;
  document.getElementById('cdkeyInput').focus();
}

function hideRedeemModal() {
  document.getElementById('redeemModal').classList.remove('show');
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
    const r = await fetch('/api/cdkey/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    document.getElementById('redeemSuccess').textContent = `兑换成功！获得 ${d.points} 积分，当前余额：${d.balance} 积分`;
    document.getElementById('redeemSuccess').style.display = 'block';
    document.getElementById('navPoints').textContent = `${d.balance} 积分`;
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

function showPayModal() {
  if (!localStorage.getItem('token')) {
    window.location.href = loginUrl;
    return;
  }
  document.getElementById('payModal').classList.add('show');
  document.getElementById('payStatusBar').style.display = 'none';
  document.getElementById('payQrArea').innerHTML = '<p style="color:var(--text-muted);font-size:14px;">请先选择积分套餐</p>';
}

function hidePayModal() {
  document.getElementById('payModal').classList.remove('show');
}

function selectChannel(channel) {
  selectedChannel = channel;
  document.querySelectorAll('.pay-channel-btn').forEach((button) => button.classList.remove('active'));
  document.querySelector(`[data-channel="${channel}"]`).classList.add('active');
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
  document.getElementById('payStatusBar').style.display = 'flex';
  document.getElementById('payQrArea').innerHTML = '<p style="color:var(--text-muted);font-size:14px;">正在创建订单...</p>';
  try {
    const r = await fetch('/api/payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ points: selectedPoints, channel: selectedChannel })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    document.getElementById('payQrArea').innerHTML =
      '<img src="' + escapeHtml(d.qrCode) + '" alt="支付二维码">' +
      '<div class="hint">请使用' + (selectedChannel === 'alipay' ? '支付宝' : '微信') + '扫码支付</div>' +
      '<div class="hint" style="font-size:12px;color:var(--text-dim);margin-top:4px;">订单号：' + escapeHtml(d.orderNo) + '</div>';
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts += 1;
      try {
        const sr = await fetch(`/api/payment/status/${d.orderNo}`, { headers: { Authorization: `Bearer ${token}` } });
        const sd = await sr.json();
        if (sd.order && sd.order.status === 'paid') {
          clearInterval(poll);
          document.getElementById('payStatusBar').style.display = 'none';
          document.getElementById('payQrArea').innerHTML =
            '<div style="color:var(--neon-green);font-size:48px;margin-bottom:12px;">&#x2705;</div>' +
            '<div style="color:var(--text-primary);font-weight:800;font-size:18px;margin-bottom:4px;">支付成功！</div>' +
            '<div style="color:var(--neon-cyan);font-weight:700;">获得 ' + escapeHtml(sd.order.points) + ' 积分</div>';
          document.getElementById('navPoints').textContent = `${Number(sd.balance || 0)} 积分`;
          return;
        }
      } catch {}
      if (attempts >= 30) {
        clearInterval(poll);
        document.getElementById('payStatusBar').style.display = 'none';
        document.getElementById('payQrArea').innerHTML =
          '<p style="color:var(--text-muted);font-size:14px;">支付超时，请重试</p>' +
          '<button class="shop-btn buy" style="margin-top:12px;width:auto;padding:10px 24px;" onclick="createPayment()">重新支付</button>';
      }
    }, 3000);
  } catch (err) {
    document.getElementById('payStatusBar').style.display = 'none';
    document.getElementById('payQrArea').innerHTML = '<p style="color:var(--neon-red);font-size:14px;">创建订单失败：' + escapeHtml(err.message) + '</p>';
  }
}

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
