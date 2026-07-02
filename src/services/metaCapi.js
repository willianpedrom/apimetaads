const axios = require('axios');
const { hashData, normalizePhone } = require('../utils/hash');
const db = require('../db/pool');
const { v4: uuidv4 } = require('uuid');

// Cache em memória para evitar requisições de GeoIP repetidas e rate limiting
const ipCache = new Map();

/**
 * Consulta a geolocalização do IP usando o serviço gratuito ip-api.com
 * com cache em memória de 1 hora.
 */
async function getGeoIp(ip) {
    if (!ip) return null;
    
    // Extrai o primeiro IP se for uma lista separada por vírgula (comum com proxy/CDN)
    const cleanIp = String(ip).split(',')[0].trim();
    
    if (
        cleanIp === '127.0.0.1' || 
        cleanIp === '::1' || 
        cleanIp.startsWith('192.168.') || 
        cleanIp.startsWith('10.') || 
        cleanIp.startsWith('172.16.')
    ) {
        return null;
    }
    
    if (ipCache.has(cleanIp)) {
        return ipCache.get(cleanIp);
    }
    
    try {
        const response = await axios.get(`http://ip-api.com/json/${cleanIp}`, { timeout: 1500 });
        if (response.data && response.data.status === 'success') {
            const geo = {
                cidade: response.data.city,
                estado: response.data.region?.toLowerCase(),
                pais: response.data.countryCode?.toLowerCase()
            };
            ipCache.set(cleanIp, geo);
            // Expira o IP do cache em 1 hora
            setTimeout(() => ipCache.delete(cleanIp), 3600 * 1000);
            return geo;
        }
    } catch (_) {
        // Ignora falhas de timeout ou rate limits
    }
    return null;
}

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
    userData = {},
    geoHeaders = {}
}) {
    if (!pixelId || !accessToken) {
        console.warn(`[CAPI] Configuração ausente para o site ID ${siteId}. Ignorando envio.`);
        return { success: false, response: 'Configuração de Pixel ou Token ausente.' };
    }

    // Identificação única para o log interno
    const logId = uuidv4();

    // Limpa IP do cliente
    const cleanIp = clientIp ? String(clientIp).split(',')[0].trim() : undefined;

    // Enriquece geolocalização se faltarem dados de Cidade, Estado ou País
    let geo = null;
    if (!userData.cidade || !userData.estado || !userData.pais) {
        // 1. Tenta obter geolocalização via cabeçalhos HTTP do proxy/CDN (Cloudflare ou Vercel)
        if (geoHeaders.cidade || geoHeaders.estado || geoHeaders.pais) {
            geo = {
                cidade: geoHeaders.cidade,
                estado: geoHeaders.estado,
                pais: geoHeaders.pais
            };
        } else {
            // 2. Fallback: consulta baseada no IP de origem
            geo = await getGeoIp(cleanIp);
        }
    }

    const cidade = userData.cidade || geo?.cidade;
    const estado = userData.estado || geo?.estado;
    const pais = userData.pais || geo?.pais || 'br';

    // Monta o objeto de dados do usuário (PII)
    const payloadUserData = {
        // Dados de conexão direta (não-hasheados)
        client_ip_address: cleanIp,
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
        ct: cidade ? [hashData(cidade)] : undefined,
        st: estado ? [hashData(estado)] : undefined,
        zp: userData.cep ? [hashData(userData.cep.replace(/\D/g, ''))] : undefined,
        country: [hashData(pais)]
    };

    // Mapeia chaves de custom data comuns (como value e currency) que podem estar na raiz do userData
    const customData = userData.customData || {};
    if (userData.value !== undefined && customData.value === undefined) {
        customData.value = parseFloat(userData.value);
    }
    if (userData.currency !== undefined && customData.currency === undefined) {
        customData.currency = String(userData.currency).toUpperCase();
    }
    if (userData.content_name !== undefined && customData.content_name === undefined) {
        customData.content_name = userData.content_name;
    }
    if (userData.content_type !== undefined && customData.content_type === undefined) {
        customData.content_type = userData.content_type;
    }
    if (userData.contents !== undefined && customData.contents === undefined) {
        customData.contents = userData.contents;
    }
    if (userData.content_ids !== undefined && customData.content_ids === undefined) {
        customData.content_ids = userData.content_ids;
    }

    // Monta o evento CAPI conforme a documentação oficial da Meta
    const eventPayload = {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId || uuidv4(), // Crucial para deduplicação com o browser-side pixel
        action_source: 'website',
        event_source_url: pageUrl,
        user_data: payloadUserData,
        custom_data: Object.keys(customData).length > 0 ? customData : undefined
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
