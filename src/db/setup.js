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
        
        // Seeder: Insere um site de exemplo caso o banco esteja vazio
        const countRes = await pool.query('SELECT COUNT(*) as count FROM sites');
        const count = parseInt(countRes.rows[0].count || countRes.rows[0]['COUNT(*)'] || 0);
        if (count === 0) {
            await pool.query(
                `INSERT INTO sites (id, nome, dominio, meta_pixel_id, meta_pixel_token, test_event_code)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    'exemplo-site-uuid',
                    'Site Exemplo do Willian',
                    'site-do-willian.com',
                    '123456789012345',
                    'EAAG_exemplo_token_capi',
                    'TEST12345'
                ]
            );
            console.log('🌱 Seeding: Site de exemplo cadastrado no banco de dados!');
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
