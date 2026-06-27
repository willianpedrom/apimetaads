const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { parse } = require('pg-connection-string');

const databaseUrl = process.env.DATABASE_URL;
let isPostgres = false;
let pgPool = null;
let sqliteDb = null;

if (databaseUrl && (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://'))) {
    isPostgres = true;
    try {
        const config = parse(databaseUrl);
        console.log(`🔌 DB Postgres: host=${config.host}, database=${config.database}`);
        pgPool = new Pool({
            host: config.host,
            port: parseInt(config.port || '5432'),
            database: config.database,
            user: config.user,
            password: config.password,
            ssl: { rejectUnauthorized: false },
            max: 10,
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
        });
    } catch (err) {
        console.error('❌ Erro ao configurar pool Postgres, mudando para SQLite local:', err.message);
        isPostgres = false;
    }
}

if (!isPostgres) {
    const dbPath = path.join(__dirname, '../../database.sqlite');
    console.log(`🔌 DB SQLite local: file=${dbPath}`);
    sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('❌ Erro ao abrir banco SQLite:', err.message);
        }
    });
}

/**
 * Interface unificada para queries em PostgreSQL ou SQLite.
 * Suporta a sintaxe de parâmetros do Postgres ($1, $2...) em ambos.
 */
function query(text, params = []) {
    if (isPostgres) {
        return pgPool.query(text, params);
    } else {
        return new Promise((resolve, reject) => {
            // Converte sintaxe Postgres ($1, $2...) para SQLite (?)
            // Ex: "INSERT INTO sites(id, nome) VALUES($1, $2)" -> "INSERT INTO sites(id, nome) VALUES(?, ?)"
            const sqliteText = text.replace(/\$(\d+)/g, '?');

            // Determina se a query é de modificação ou leitura
            const isSelect = sqliteText.trim().substring(0, 6).toUpperCase() === 'SELECT';

            if (isSelect) {
                sqliteDb.all(sqliteText, params, (err, rows) => {
                    if (err) return reject(err);
                    resolve({ rows, rowCount: rows.length });
                });
            } else {
                sqliteDb.run(sqliteText, params, function(err) {
                    if (err) return reject(err);
                    // Retorna estrutura compatível com pg
                    resolve({ rows: [], rowCount: this.changes });
                });
            }
        });
    }
}

module.exports = {
    query,
    isPostgres
};
