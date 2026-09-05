const bcrypt = require('bcryptjs');
const crypto = require('crypto');

function initDatabase(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    client_id TEXT NOT NULL, endpoint TEXT NOT NULL, fingerprint TEXT NOT NULL,
    charged INTEGER NOT NULL, refunded INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running', result TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT,
    UNIQUE(user_id, client_id)
  )`);
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

  const userColumns = db.prepare('PRAGMA table_info(users)').all();
  if (!userColumns.some((column) => column.name === 'deleted_at')) db.exec('ALTER TABLE users ADD COLUMN deleted_at TEXT');
  if (!userColumns.some((column) => column.name === 'token_version')) {
    db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  }
  if (!userColumns.some((column) => column.name === 'status')) {
    db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!userColumns.some((column) => column.name === 'status_reason')) {
    db.exec("ALTER TABLE users ADD COLUMN status_reason TEXT NOT NULL DEFAULT ''");
  }
  if (!userColumns.some((column) => column.name === 'status_until')) {
    db.exec('ALTER TABLE users ADD COLUMN status_until DATETIME');
  }
  if (!userColumns.some((column) => column.name === 'policy_version')) {
    db.exec("ALTER TABLE users ADD COLUMN policy_version TEXT NOT NULL DEFAULT ''");
  }
  if (!userColumns.some((column) => column.name === 'policy_accepted_at')) {
    db.exec('ALTER TABLE users ADD COLUMN policy_accepted_at DATETIME');
  }
  if (!userColumns.some((column) => column.name === 'policy_ip')) {
    db.exec("ALTER TABLE users ADD COLUMN policy_ip TEXT NOT NULL DEFAULT ''");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance INTEGER NOT NULL,
      description TEXT,
      reference_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  const pointLogColumns = db.prepare('PRAGMA table_info(point_logs)').all();
  if (!pointLogColumns.some((column) => column.name === 'reference_key')) {
    db.exec('ALTER TABLE point_logs ADD COLUMN reference_key TEXT');
  }

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
  if (!historyColumns.some((column) => column.name === 'operation_id')) {
    db.exec('ALTER TABLE history ADD COLUMN operation_id TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_history_operation ON history(operation_id)');
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      event_name TEXT NOT NULL,
      request_id TEXT,
      properties TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_history_user_id ON history(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_history_client_task ON history(user_id, client_task_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_point_logs_user_id ON point_logs(user_id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_point_logs_reference_key ON point_logs(reference_key) WHERE reference_key IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cdkeys_code ON cdkeys(code)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_templates_user_type ON templates(user_id, type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_logs(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_logs(admin_user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_analytics_event_created ON analytics_events(event_name, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)');
  db.exec(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id),
    category TEXT NOT NULL, task_id TEXT NOT NULL DEFAULT '', message TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '', access_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', reply TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS provider_costs (
    day TEXT NOT NULL, currency TEXT NOT NULL, amount REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '', updated_by INTEGER NOT NULL REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(day, currency)
  )`);

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
