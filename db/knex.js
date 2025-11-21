const knex = require('knex');
const config = require('../config');

let instance;

function getKnex() {
  if (!instance) {
    const connection = {
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
      user: config.database.user,
      password:
        config.database.password == null
          ? undefined
          : String(config.database.password),
      ssl: config.database.ssl,
    };

    if (connection.password == null) {
      console.warn('[db] DATABASE_PASSWORD is not set. Postgres authentication will fail.');
    } else if (typeof connection.password !== 'string') {
      console.warn('[db] Coercing database password to string from type', typeof connection.password);
      connection.password = String(connection.password);
    }

    instance = knex({
      client: 'pg',
      connection,
      searchPath: ['auction', 'public'],
      pool: {
        min: 0,
        max: 10,
      },
    });
  }
  return instance;
}

async function healthCheck() {
  const db = getKnex();
  await db.raw('select 1');
}

async function destroy() {
  if (instance) {
    await instance.destroy();
    instance = null;
  }
}

module.exports = {
  getKnex,
  healthCheck,
  destroy,
};
