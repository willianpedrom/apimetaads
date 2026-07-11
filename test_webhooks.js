const { fork } = require('child_process');
const axios = require('axios');
const db = require('./src/db/pool');

console.log('🧪 Iniciando testes de integração dos Webhooks (Hotmart e Payt)...\n');

async function runTest() {
    // Garante que existe pelo menos um site ativo no DB para testar
    let siteId = 'exemplo-site-uuid';
    try {
        const sitesRes = await db.query('SELECT id FROM sites WHERE ativo = TRUE LIMIT 1');
        if (sitesRes.rows.length > 0) {
            siteId = sitesRes.rows[0].id;
            console.log(`Usando site existente com ID: ${siteId}`);
        } else {
            console.log('Nenhum site ativo encontrado. Inserindo site temporário para teste...');
            await db.query(
                `INSERT INTO sites (id, nome, dominio, meta_pixel_id, meta_pixel_token, test_event_code)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    'exemplo-site-uuid',
                    'Site Exemplo de Teste',
                    'teste.com',
                    '1234567890',
                    'EAAG_token_teste',
                    'TEST12345'
                ]
            );
        }
    } catch (dbInitErr) {
        console.error('Falha ao inicializar site de teste no DB:', dbInitErr.message);
    }

    // 1. Inicia o servidor em background com stdio herdado para ver os logs do express
    const serverProcess = fork('src/index.js', [], { 
        env: { ...process.env, PORT: '3005' },
        stdio: 'inherit'
    });
    
    // Aguarda o servidor inicializar
    await new Promise(resolve => setTimeout(resolve, 3000));

    try {
        console.log('--- 1. Testando Webhook Hotmart ---');
        const hotmartPayload = {
            id: 'event-uuid-hotmart-test',
            event: 'PURCHASE_APPROVED',
            creation_date: Date.now(),
            data: {
                buyer: {
                    name: 'Comprador Hotmart Teste',
                    email: 'comprador-hotmart@teste.com',
                    checkout_phone: '5511988888888'
                },
                purchase: {
                    transaction: 'HP1234567890',
                    price: {
                        value: 199.90,
                        currency_code: 'BRL'
                    }
                },
                product: {
                    name: 'Curso Teste Hotmart'
                }
            }
        };

        const hotmartRes = await axios.post(`http://localhost:3005/api/webhooks/hotmart?site_id=${siteId}`, hotmartPayload);
        console.log('Hotmart Response:', hotmartRes.data);

        console.log('\n--- 2. Testando Webhook Payt ---');
        const paytPayload = {
            id: 'event-uuid-payt-test',
            status: 'finalizada',
            customer_name: 'Comprador Payt Teste',
            email: 'comprador-payt@teste.com',
            phone: '5521977777777',
            transaction_id: 'PT987654321',
            amount: 299.90,
            currency: 'BRL',
            product_name: 'Mentoria Teste Payt'
        };

        const paytRes = await axios.post(`http://localhost:3005/api/webhooks/payt?site_id=${siteId}`, paytPayload);
        console.log('Payt Response:', paytRes.data);

        // Aguarda a gravação no banco de dados (CAPI Graph API calls take time to resolve)
        await new Promise(resolve => setTimeout(resolve, 6000));

        console.log('\n--- 3. Verificando logs no Banco de Dados ---');
        const logsRes = await db.query("SELECT * FROM events_log WHERE event_name = 'Purchase' ORDER BY criado_em DESC LIMIT 2");
        
        console.log(`Encontrados ${logsRes.rows.length} eventos Purchase no banco de dados.`);
        
        logsRes.rows.forEach(log => {
            console.log(`- Evento: ${log.event_name}, ID Evento: ${log.event_id}, Status Envio: ${log.status}, Resposta: ${log.response_body}`);
        });

        if (logsRes.rows.length === 2) {
            console.log('\n✅ PASS - Webhooks cadastrados e processando eventos com sucesso!');
        } else {
            console.log('\n❌ FAIL - Número de eventos Purchase registrados é menor do que o esperado.');
        }

    } catch (err) {
        console.error('\n❌ Erro durante a execução dos testes:', err);
    } finally {
        // Encerra o processo do servidor
        serverProcess.kill();
        process.exit(0);
    }
}

runTest();
