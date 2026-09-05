const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { pipeline } = require('node:stream/promises');
require('dotenv').config();

const hashFile = (file) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject);
  stream.on('end', () => resolve(hash.digest('hex')));
});

async function copyBackupFile(source, destination) {
  // 部分 Windows ACL/杀毒驱动拒绝 CopyFile，但允许普通文件流读写。
  // 使用相同权限进行流式复制，不放宽任何文件权限。
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await pipeline(fs.createReadStream(source), fs.createWriteStream(destination)); return; }
    catch (error) {
      if (!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

function contained(root, relative) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('备份路径越界');
  return target;
}

function references(database) {
  const names = new Set();
  for (const row of database.prepare('SELECT image_url, content FROM history').iterate()) {
    for (const value of [row.image_url, row.content]) {
      for (const match of String(value || '').matchAll(/\/uploads\/([^"'?#\\/\s]+)/g)) {
        if (match[1] !== path.basename(match[1])) throw new Error('图片路径不合法');
        names.add(match[1]);
      }
    }
  }
  return [...names];
}

async function verifyBackup(directory) {
  const root = path.resolve(directory);
  const manifest = JSON.parse(fs.readFileSync(contained(root, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('备份清单无效');
  const covered = new Set();
  for (const entry of manifest.files) {
    if (await hashFile(contained(root, entry.path)) !== entry.sha256) throw new Error('备份文件校验失败：' + entry.path);
    covered.add(entry.path);
  }
  if (!covered.has('data.db')) throw new Error('备份缺少数据库');
  const restored = new Database(contained(root, 'data.db'), { readonly: true, fileMustExist: true });
  try {
    if (restored.pragma('integrity_check', { simple: true }) !== 'ok' || restored.pragma('foreign_key_check').length) throw new Error('数据库恢复校验失败');
    for (const filename of references(restored)) if (!covered.has('uploads/' + filename)) throw new Error('备份缺少被引用图片：' + filename);
    return { verified: true, files: covered.size, users: restored.prepare('SELECT COUNT(*) count FROM users').get().count };
  } finally { restored.close(); }
}

async function createBackup({ databasePath, uploadsDir, backupDir, mirrorDir } = {}) {
  const root = path.resolve(backupDir || process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
  const sourceDb = path.resolve(databasePath || process.env.DATABASE_PATH || path.join(__dirname, '..', 'data.db'));
  const sourceUploads = path.resolve(uploadsDir || path.join(__dirname, '..', 'uploads'));
  const name = 'snapshot-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
  const destination = contained(root, name);
  fs.mkdirSync(contained(destination, 'uploads'), { recursive: true });
  const source = new Database(sourceDb, { readonly: true, fileMustExist: true });
  try { await source.backup(contained(destination, 'data.db')); } finally { source.close(); }
  const snapshot = new Database(contained(destination, 'data.db'), { readonly: true });
  let filenames;
  try { filenames = references(snapshot); } finally { snapshot.close(); }
  const requiredBytes = filenames.reduce((sum, filename) => sum + fs.statSync(contained(sourceUploads, filename)).size, 0);
  const disk = fs.statfsSync(root);
  if (Number(disk.bavail) * Number(disk.bsize) < requiredBytes + 1024 ** 3) throw new Error('剩余磁盘不足以完成备份并保留1GB空间');
  for (const filename of filenames) {
    // 保存真实文件副本；不把密钥或整个项目混进备份。
    await copyBackupFile(contained(sourceUploads, filename), contained(destination, 'uploads/' + filename));
  }
  const files = [];
  for (const relative of ['data.db', ...filenames.map(name => 'uploads/' + name)]) files.push({ path: relative, sha256: await hashFile(contained(destination, relative)) });
  fs.writeFileSync(contained(destination, 'manifest.json'), JSON.stringify({ version: 1, files }, null, 2));
  const verification = await verifyBackup(destination);
  const mirror = mirrorDir || process.env.BACKUP_MIRROR_DIR;
  if (mirror) {
    const mirrorRoot = path.resolve(mirror);
    if (mirrorRoot === root || mirrorRoot.startsWith(root + path.sep) || root.startsWith(mirrorRoot + path.sep)) throw new Error('异地备份目录必须独立于本机备份目录');
    const mirrorDestination = contained(mirrorRoot, name);
    fs.mkdirSync(contained(mirrorDestination, 'uploads'), { recursive: true });
    for (const relative of ['manifest.json', ...files.map(entry => entry.path)]) await copyBackupFile(contained(destination, relative), contained(mirrorDestination, relative));
    await verifyBackup(mirrorDestination);
    pruneSnapshots(mirrorRoot, name);
  }
  const status = { completedAt: new Date().toISOString(), snapshot: name, verified: verification.verified, files: verification.files, mirrored: Boolean(mirror) };
  const tempStatus = contained(root, 'latest-status.tmp');
  fs.writeFileSync(tempStatus, JSON.stringify(status));
  fs.renameSync(tempStatus, contained(root, 'latest-status.json'));
  pruneSnapshots(root, name);
  return { ...status, directory: destination };
}

function pruneSnapshots(root, current) {
  const retention = Math.min(30, Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS) || 7));
  const cutoff = Date.now() - retention * 86400000;
  const resolvedRoot = fs.realpathSync(root);
  for (const entry of fs.readdirSync(resolvedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === current || !/^snapshot-\d{4}-\d{2}-\d{2}T[\d-Z]+-[a-f0-9]{6}$/.test(entry.name)) continue;
    const target = contained(resolvedRoot, entry.name);
    // 递归清理前核实真实路径仍是备份根目录的直接子目录。
    if (fs.realpathSync(target) !== target || path.dirname(target) !== resolvedRoot) throw new Error('备份清理路径异常');
    if (fs.statSync(target).mtimeMs < cutoff) fs.rmSync(target, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const action = process.argv[2] === '--verify' ? verifyBackup(process.argv[3] || '') : createBackup();
  action.then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error('完整备份失败：', error.message); process.exitCode = 1; });
}
module.exports = { createBackup, verifyBackup };
