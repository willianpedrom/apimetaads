const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function runSetup() {
    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const sql = fs.readFileSync(schemaPath, 'utf8');

        // Remove comentários de linha (começando com --) antes de fazer o split por ponto e vírgula
        const cleanSql = sql
            .split('\n')
            .filter(line => !line.trim().startsWith('--'))
            .join('\n');

        // Divide as queries por ponto e vírgula de forma segura
        const queries = cleanSql
            .split(';')
            .map(q => q.trim())
            .filter(q => q.length > 0);

        console.log('🔄 Executando inicialização do banco de dados...');
        
        for (const queryStr of queries) {
            await pool.query(queryStr);
        }
        
        console.log('✅ Banco de dados configurado com sucesso!');
    } catch (err) {
        console.error('❌ Falha na inicialização do banco de dados:', err.message);
        process.exit(1);
    }
}

if (require.main === module) {
    runSetup();
}

module.exports = runSetup;
