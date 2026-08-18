const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, '..', 'data.db');
const db = new Database(dbPath);

module.exports = {
  db,
  dbPath
};
