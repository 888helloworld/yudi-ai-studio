const bcrypt = require('bcryptjs');
const crypto = require('crypto');

function initDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      points INTEGER DEFAULT 1000,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance INTEGER NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      sub_type TEXT,
      content TEXT,
      image_url TEXT,
      prompt TEXT,
      ratio TEXT,
      cost_points INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  const historyColumns = db.prepare('PRAGMA table_info(history)').all();
  if (!historyColumns.some((column) => column.name === 'client_task_id')) {
    db.exec('ALTER TABLE history ADD COLUMN client_task_id TEXT');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS cdkeys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      points INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      used_by INTEGER,
      used_at DATETIME,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (used_by) REFERENCES users(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      points INTEGER NOT NULL,
      channel TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      trade_no TEXT,
      paid_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, name, type),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_history_user_id ON history(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_history_client_task ON history(user_id, client_task_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_point_logs_user_id ON point_logs(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cdkeys_code ON cdkeys(code)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_templates_user_type ON templates(user_id, type)');

  const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!adminExists) {
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomUUID();
    const hash = bcrypt.hashSync(adminPassword, 10);
    db.prepare('INSERT INTO users (username, password_hash, points, role) VALUES (?, ?, ?, ?)')
      .run(adminUsername, hash, 99999, 'admin');
    console.log('Initial administrator account created.');
    if (!process.env.ADMIN_PASSWORD) {
      console.log('Set ADMIN_PASSWORD in .env before first launch to choose the initial password.');
    }
  }

  console.log('数据库初始化完成');
}

module.exports = {
  initDatabase
};
