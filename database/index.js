const { db, dbPath } = require('./connection');
const { initDatabase } = require('./schema');

initDatabase(db);

module.exports = {
  db,
  dbPath
};
