const axios = require('axios');
const { hashData, normalizePhone } = require('../utils/hash');
const db = require('../db/pool');
const { v4: uuidv4 } = require('uuid');

/**
 * Envia o evento de servidor para a Meta Graph API (Conversions API)
 * e registra o status de envio no log local.
 */
async function sendMetaCapiEvent({
    siteId,
    pixelId,
    accessToken,
    testEventCode,
    eventName,
    eventId,
    pageUrl,
    clientIp,
    userAgent,
    cookies = {},
    userData = {}
}) {
    if (!pixelId || !accessToken) {
        console.warn(`[CAPI] Configuração ausente para o site ID ${siteId}. Ignorando envio.`);
        return;
    }

    // Identificação única para o log interno
    const logId = uuidv4();

    // Monta o objeto de dados do usuário (PII)
    const payloadUserData = {
        // Dados de conexão direta (não-hasheados)
        client_ip_address: clientIp,
        client_user_agent: userAgent,
        fbp: cookies._fbp || undefined,
        fbc: cookies._fbc || undefined,

        // Dados pessoais hasheados com SHA-256
        em: userData.email ? [hashData(userData.email)] : undefined,
        ph: userData.telefone ? [normalizePhone(userData.telefone)] : undefined,
        fn: userData.nome ? [hashData(userData.nome.split(' ')[0])] : undefined,
        ln: userData.nome && userData.nome.split(' ').length > 1 
            ? [hashData(userData.nome.split(' ').slice(1).join(' '))] 
            : undefined,
        external_id: userData.userId ? [hashData(userData.userId)] : undefined,
        
        // Dados geográficos hasheados
        ct: userData.cidade ? [hashData(userData.cidade)] : undefined,
        st: userData.estado ? [hashData(userData.estado)] : undefined,
        zp: userData.cep ? [hashData(userData.cep.replace(/\D/g, ''))] : undefined,
        country: userData.pais ? [hashData(userData.pais)] : [hashData('br')]
    };

    // Monta o evento CAPI conforme a documentação oficial da Meta
    const eventPayload = {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId || uuidv4(), // Crucial para deduplicação com o browser-side pixel
        action_source: 'website',
        event_source_url: pageUrl,
        user_data: payloadUserData,
        custom_data: userData.customData || undefined
    };

    const requestBody = {
        data: [eventPayload]
    };

    if (testEventCode) {
        requestBody.test_event_code = testEventCode;
    }

    let status = 'success';
    let responseBody = '';

    try {
        const url = `https://graph.facebook.com/v19.0/${pixelId}/events`;
        const response = await axios.post(url, requestBody, {
            params: { access_token: accessToken },
            headers: { 'Content-Type': 'application/json' },
            timeout: 8000 // Timeout para evitar requisições presas
        });
        
        responseBody = JSON.stringify(response.data);
        console.log(`[CAPI] Evento '${eventName}' enviado com sucesso. ID: ${eventPayload.event_id}`);
    } catch (error) {
        status = 'failed';
        responseBody = JSON.stringify(error.response?.data || { message: error.message });
        console.error(`[CAPI] Erro ao enviar evento '${eventName}':`, responseBody);
    }

    // Registra o disparo no banco de dados de maneira assíncrona
    try {
        await db.query(
            `INSERT INTO events_log (id, site_id, event_name, event_id, page_url, status, response_body)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [logId, siteId, eventName, eventPayload.event_id, pageUrl, status, responseBody]
        );
    } catch (dbErr) {
        console.error('[CAPI Log] Falha ao registrar log no banco:', dbErr.message);
    }

    return { success: status === 'success', response: responseBody };
}

module.exports = {
    sendMetaCapiEvent
};
