const { hashData, normalizePhone } = require('./src/utils/hash');
const { sendMetaCapiEvent } = require('./src/services/metaCapi');

console.log('🧪 Iniciando testes de validação do apimetaads...\n');

// 1. Validação de Hashing
console.log('--- 1. Testando Hashing SHA-256 ---');
const email = ' Test.User@Gmail.com ';
const hashedEmail = hashData(email);
// O hash de "test.user@gmail.com" deve ser:
// fcb35d8f0a3b5a1772ed467aeea03b11efeb2f18edac1787398e8c7a97d775f1
const correctEmailHash = 'fcb35d8f0a3b5a1772ed467aeea03b11efeb2f18edac1787398e8c7a97d775f1';
console.log(`Email original: "${email}"`);
console.log(`Hashed:         "${hashedEmail}"`);
console.log(hashedEmail === correctEmailHash ? '✅ PASS - Email hasheado corretamente' : '❌ FAIL - Hash incorreto');

const phone = ' (11) 99999-9999 ';
const hashedPhone = normalizePhone(phone);
const correctPhoneHash = hashData('5511999999999');
console.log(`\nTelefone original: "${phone}"`);
console.log(`Hashed normalizado: "${hashedPhone}"`);
console.log(hashedPhone === correctPhoneHash ? '✅ PASS - Telefone normalizado e hasheado corretamente' : '❌ FAIL - Telefone incorreto');

// 2. Validação da Conectividade da API de Conversões da Meta
async function runCapiTest() {
    console.log('\n--- 2. Testando Chamada Conversions API (Meta Endpoint) ---');
    
    // Inicializa o banco de dados antes para que a gravação do log funcione
    const runSetup = require('./src/db/setup');
    await runSetup();
    
    console.log('Enviando requisição teste para a Meta (Pixel e Token falsos)...');
    
    // Este envio deve falhar na autenticação com a Meta, mas prova que nossa chamada HTTP
    // e o processamento de respostas do Axios estão funcionando perfeitamente.
    const result = await sendMetaCapiEvent({
        siteId: 'test-site-id',
        pixelId: '1234567890',
        accessToken: 'EAAG_falsotoken_de_teste',
        testEventCode: 'TEST12345',
        eventName: 'Lead',
        eventId: 'test-event-uuid-12345',
        pageUrl: 'https://seusite.com/checkout',
        clientIp: '127.0.0.1',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        userData: {
            email: 'cliente@exemplo.com',
            telefone: '11999999999',
            nome: 'Cliente Exemplo'
        }
    });

    console.log('\nResultado do Teste de Comunicação CAPI:');
    if (result && result.success === false && result.response.includes('OAuthException')) {
        console.log('✅ PASS - A chamada alcançou a Graph API da Meta e foi rejeitada corretamente por token inválido (OAuthException).');
    } else {
        console.log('❌ FAIL - O comportamento da resposta diferiu do esperado:', result);
    }
}

runCapiTest();
