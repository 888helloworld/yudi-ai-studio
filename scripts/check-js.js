const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJECT_ROOT = path.join(__dirname, '..');
const SKIP_DIRECTORIES = new Set([
  '.git',
  '.agents',
  '.playwright-cli',
  'backups',
  'node_modules',
  'uploads',
  'output',
  'logs'
]);

function collectJavaScriptFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        collectJavaScriptFiles(path.join(directory, entry.name), files);
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

const files = collectJavaScriptFiles(PROJECT_ROOT).sort();
for (const filepath of files) {
  try {
    const source = fs.readFileSync(filepath, 'utf8').replace(/^#!.*\r?\n/, '');
    new vm.Script(source, { filename: filepath });
  } catch (err) {
    console.error(err.stack || err.message || err);
    process.exit(1);
  }
}

console.log(`JavaScript 语法检查通过：${files.length} 个文件`);
