const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { db } = require('../database');
const { UPLOAD_DIR } = require('../utils/image-storage');

function collectReferencedFiles() {
  const references = new Set();
  const rows = db.prepare('SELECT image_url, content FROM history').all();
  const pattern = /\/uploads\/([^"'?#\\/\s]+)/g;
  for (const row of rows) {
    for (const value of [row.image_url, row.content]) {
      const text = String(value || '');
      let match;
      while ((match = pattern.exec(text))) references.add(path.basename(match[1]));
    }
  }
  return references;
}

function main() {
  const quarantine = process.argv.includes('--quarantine');
  const cleanupQuarantine = process.argv.includes('--cleanup-quarantine');
  const referenced = collectReferencedFiles();
  const files = fs.existsSync(UPLOAD_DIR)
    ? fs.readdirSync(UPLOAD_DIR, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name)
    : [];
  const originals = files.filter((name) => !name.endsWith('.thumb.png'));
  const orphans = originals.filter((name) => !referenced.has(name));
  const bytes = orphans.reduce((sum, name) => sum + fs.statSync(path.join(UPLOAD_DIR, name)).size, 0);
  let quarantineDir = '';
  if (quarantine && orphans.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    quarantineDir = path.join(UPLOAD_DIR, '_quarantine', stamp);
    fs.mkdirSync(quarantineDir, { recursive: true });
    for (const name of orphans) {
      fs.renameSync(path.join(UPLOAD_DIR, name), path.join(quarantineDir, name));
      const thumbnail = path.join(UPLOAD_DIR, `${name}.thumb.png`);
      if (fs.existsSync(thumbnail)) fs.renameSync(thumbnail, path.join(quarantineDir, `${name}.thumb.png`));
    }
  }
  const removedQuarantineDirs = [];
  if (cleanupQuarantine) {
    const quarantineRoot = path.join(UPLOAD_DIR, '_quarantine');
    const configuredDays = Number(process.env.UPLOAD_QUARANTINE_RETENTION_DAYS || 30);
    const retentionDays = Number.isFinite(configuredDays) ? Math.min(Math.max(Math.floor(configuredDays), 1), 3650) : 30;
    const cutoff = Date.now() - retentionDays * 86400000;
    if (fs.existsSync(quarantineRoot)) {
      for (const entry of fs.readdirSync(quarantineRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.resolve(quarantineRoot, entry.name);
        if (path.dirname(candidate) !== path.resolve(quarantineRoot)) continue;
        if (fs.statSync(candidate).mtimeMs >= cutoff) continue;
        fs.rmSync(candidate, { recursive: true, force: true });
        removedQuarantineDirs.push(candidate);
      }
    }
  }
  console.log(JSON.stringify({
    mode: quarantine ? 'quarantine' : 'report-only',
    uploadFiles: originals.length,
    referencedFiles: referenced.size,
    orphanFiles: orphans.length,
    orphanBytes: bytes,
    quarantineDir,
    removedQuarantineDirs,
    sample: orphans.slice(0, 50)
  }, null, 2));
}

try { main(); } finally { db.close(); }
