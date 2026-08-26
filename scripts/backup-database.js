const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config();
const { db, dbPath } = require('../database');

async function main() {
  const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `data-${stamp}.db`);
  await db.backup(target);
  const backupDb = new Database(target, { readonly: true });
  const integrity = backupDb.prepare('PRAGMA integrity_check').get();
  backupDb.close();
  if (integrity.integrity_check !== 'ok') throw new Error(`备份数据库完整性检查失败：${integrity.integrity_check}`);
  const configuredRetentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);
  const retentionDays = Number.isFinite(configuredRetentionDays)
    ? Math.min(Math.max(Math.floor(configuredRetentionDays), 0), 3650)
    : 30;
  const removed = [];
  if (retentionDays > 0) {
    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    for (const entry of fs.readdirSync(backupDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/^data-.*\.db$/.test(entry.name)) continue;
      const candidate = path.join(backupDir, entry.name);
      if (candidate === target || fs.statSync(candidate).mtimeMs >= cutoff) continue;
      fs.unlinkSync(candidate);
      removed.push(candidate);
    }
  }
  console.log(JSON.stringify({
    success: true,
    source: dbPath,
    backup: target,
    bytes: fs.statSync(target).size,
    retentionDays,
    removedExpiredBackups: removed.length
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
