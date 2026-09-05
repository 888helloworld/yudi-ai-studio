const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yudi-governance-'));
process.env.DATABASE_PATH = path.join(directory, 'test.db');
process.env.ADMIN_PASSWORD = 'TestAdmin123';
process.env.JWT_SECRET = 'isolated-governance-test-secret';
process.env.ARK_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
const app = require('../server');
const api = require('../db');
const { db } = require('../database');
const { generateToken } = require('../middleware/auth');
const operations = require('../repositories/operation-repository');
const context = require('../services/operation-context');
const { chargePoints, refundPoints } = require('../services/point-service');
const { createBackup, verifyBackup } = require('../scripts/backup-full');
let server;
let base;
test.before(async () => {
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  const root = fs.realpathSync(os.tmpdir());
  const target = fs.realpathSync(directory);
  assert.equal(path.dirname(target), root);
  assert.ok(path.basename(target).startsWith('yudi-governance-'));
  fs.rmSync(target, { recursive: true, force: true });
});
function headers(user) { return { 'Content-Type':'application/json', Authorization:'Bearer '+generateToken(user) }; }
async function post(url, body, user) {
  return fetch(base + url, { method:'POST', headers:user ? headers(user) : {'Content-Type':'application/json'}, body:JSON.stringify(body) });
}

test('连续错误登录第五次锁定，正确密码也不能绕过锁定', async () => {
  api.createUser('lock_test', 'LockPassword123');
  for (let i=1;i<=6;i++) {
    const response = await post('/api/auth/login', {username:'lock_test',password:'WrongPassword123'});
    assert.equal(response.status, i<5 ? 401 : 429);
  }
  assert.equal((await post('/api/auth/login',{username:'lock_test',password:'LockPassword123'})).status,429);
});

test('收费失败响应包含已到账退款，同请求不重复收费且查询隔离账号', async () => {
  const user = api.createUser('operation_http','OperationPass123');
  const other = api.createUser('operation_other','OperationPass123');
  const body = {topic:'测试',type:'种草',clientTaskId:'governance-task'};
  const response = await post('/generate-copy', body, user);
  const result = await response.json();
  assert.equal(response.status,500,JSON.stringify(result));
  assert.equal(result.refundedPoints,require('../config/points').POINTS.copy);
  assert.equal(result.actualCost,0);
  assert.equal(api.getUserPoints(user.id),user.points);
  assert.equal((await post('/generate-copy',body,user)).status,409);
  assert.equal((await fetch(base+'/api/user/tasks/governance-task',{headers:headers(other)})).status,404);
  const taskResponse = await fetch(base+'/api/user/tasks/governance-task',{headers:headers(user)});
  assert.equal((await taskResponse.json()).task.status,'failed');
});

test('中断任务仅退未交付部分，重复恢复和迟到退款不重复到账', () => {
  const user = api.createUser('recovery_regression','RecoveryPass123');
  const {operation} = operations.beginOperation(user.id,'recovery-regression','/generate','hash',30,'图片生成3张');
  context.run({ operation, duplicate:false }, () => {
    api.addHistory(user.id,'image',{image_url:'/uploads/recovery.png',cost_points:10});
    refundPoints(user.id,10,'少出图退款');
  });
  assert.equal(api.getUserPoints(user.id),user.points-20);
  operations.recoverOperations();
  assert.equal(api.getUserPoints(user.id),user.points-10);
  assert.equal(operations.getOperation(operation.id).status,'partial');
  operations.recoverOperations();
  context.run({operation,duplicate:false},()=>refundPoints(user.id,30,'迟到退款'));
  assert.equal(api.getUserPoints(user.id),user.points-10);
  assert.throws(()=>operations.beginOperation(user.id,'recovery-regression','/generate','different',30,'重复'),/内容不一致/);
});

test('成功文案同时保存作品和可查询结果，恢复不误退成功账目', async () => {
  const user = api.createUser('successful_operation','SuccessPass123');
  const originalFetch = global.fetch;
  const oldKey = process.env.DEEPSEEK_API_KEY;
  const oldUrl = process.env.TEXT_API_BASE_URL;
  process.env.DEEPSEEK_API_KEY = 'isolated-test-key';
  process.env.TEXT_API_BASE_URL = 'https://fixture.invalid/v1';
  global.fetch = (url, options) => String(url).startsWith('https://fixture.invalid/')
    ? Promise.resolve(new Response(JSON.stringify({choices:[{message:{content:'测试标题\n测试正文内容'}}]}),{status:200,headers:{'Content-Type':'application/json'}}))
    : originalFetch(url,options);
  try {
    const response=await post('/generate-copy',{topic:'测试成功',type:'种草',clientTaskId:'success-operation'},user);
    assert.equal(response.status,200);
    const result=await response.json();
    assert.match(result.copy,/测试正文内容/);
    assert.equal(result.refundedPoints,0);
    const cost=require('../config/points').POINTS.copy;
    assert.equal(result.actualCost,cost);
    assert.equal(api.getUserHistoryCount(user.id),1);
    assert.match(JSON.parse(operations.getUserOperation(user.id,'success-operation').result).copy,/测试正文内容/);
    operations.recoverOperations();
    assert.equal(api.getUserPoints(user.id),user.points-cost);
  } finally {
    global.fetch=originalFetch;
    process.env.DEEPSEEK_API_KEY=oldKey;
    if (oldUrl === undefined) delete process.env.TEXT_API_BASE_URL; else process.env.TEXT_API_BASE_URL=oldUrl;
  }
});

test('运行中占位记录不算交付，重启后退款并解除删除限制', () => {
  const user = api.createUser('reverse_recovery','RecoveryPass123');
  const {operation} = operations.beginOperation(user.id,'reverse-recovery','/api/xi-image/reverse-prompt','hash',1,'识图');
  let historyId;
  context.run({operation},()=> { historyId=api.addHistory(user.id,'reverse',{content:JSON.stringify({status:'running'}),cost_points:1}); });
  assert.equal(api.deleteHistory(historyId,user.id).reason,'active');
  operations.recoverOperations();
  assert.equal(api.getUserPoints(user.id),user.points);
  assert.equal(api.deleteHistory(historyId,user.id).success,true);
});

test('注销账号保留账目、清理作品并撤销登录', () => {
  const user = api.createUser('close_account','CloseAccount123');
  const token=generateToken(user);
  api.addHistory(user.id,'copy',{content:'需要删除的私密内容',cost_points:1});
  const order=api.createPaymentOrder(user.id,1,10,'test');
  api.paySuccess(order.order_no,'close-account-trade');
  assert.equal(api.deleteUser(user.id),true);
  const row=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  assert.notEqual(row.username,user.username);
  assert.equal(row.status,'banned');
  assert.ok(row.deleted_at);
  assert.ok(db.prepare('SELECT id FROM point_logs WHERE user_id=?').get(user.id));
  assert.ok(db.prepare('SELECT id FROM payment_orders WHERE user_id=?').get(user.id));
  assert.equal(api.getUserHistoryCount(user.id),0);
  assert.notEqual(row.token_version,0);
  assert.ok(token);
});

test('反馈查询码和管理权限隔离，管理员回复可查询', async () => {
  const response=await post('/api/feedback',{category:'account',message:'无法登录，请帮助核实账号'});
  assert.equal(response.status,200);
  const item=await response.json();
  assert.equal((await fetch(base+'/api/feedback/'+item.id)).status,404);
  const ordinary=api.createUser('feedback_ordinary','FeedbackPass123');
  assert.equal((await post('/api/admin/feedback/'+item.id,{reply:'伪造回复',status:'resolved'},ordinary)).status,403);
  const admin=db.prepare("SELECT * FROM users WHERE role='admin'").get();
  assert.equal((await post('/api/admin/feedback/'+item.id,{reply:'请提供账号信息，勿发送密码。',status:'resolved'},admin)).status,200);
  const query=await fetch(base+'/api/feedback/'+item.id,{headers:{'X-Feedback-Code':item.accessCode}});
  assert.equal((await query.json()).reply,'请提供账号信息，勿发送密码。');
  assert.equal((await fetch(base+'/api/admin/operations',{headers:headers(ordinary)})).status,403);
  assert.equal((await fetch(base+'/api/admin/operations',{headers:headers(admin)})).status,200);
});

test('完整备份可恢复数据库和图片，篡改或缺图会被拒绝', async () => {
  const backupDb=path.join(directory,'backup-source.db');
  const source=new Database(backupDb);
  source.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1); CREATE TABLE history(image_url TEXT,content TEXT);');
  source.prepare('INSERT INTO history VALUES(?,?)').run('/uploads/test.png','');
  source.close();
  const uploads=path.join(directory,'uploads');fs.mkdirSync(uploads);
  fs.writeFileSync(path.join(uploads,'test.png'),crypto.randomBytes(64));
  const result=await createBackup({databasePath:backupDb,uploadsDir:uploads,backupDir:path.join(directory,'backups'),mirrorDir:path.join(directory,'mirror')});
  assert.equal(result.mirrored,true);
  assert.equal((await verifyBackup(result.directory)).verified,true);
  fs.appendFileSync(path.join(result.directory,'uploads/test.png'),'tampered');
  await assert.rejects(verifyBackup(result.directory),/校验失败/);
});
