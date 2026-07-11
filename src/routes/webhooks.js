const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { sendMetaCapiEvent } = require('../services/metaCapi');

// Helper para buscar site ativo pelo ID
async function findActiveSite(siteId, res) {
    if (!siteId) {
        res.status(400).json({ error: 'Parâmetro site_id é obrigatório.' });
        return null;
    }
    try {
        const result = await db.query('SELECT * FROM sites WHERE id = $1 AND ativo = TRUE', [siteId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Site não encontrado ou inativo.' });
            return null;
        }
        return result.rows[0];
    } catch (err) {
        console.error('[Webhook DB Error]', err);
        res.status(500).json({ error: 'Erro interno ao consultar banco de dados.' });
        return null;
    }
}

// POST /api/webhooks/hotmart – Recebe notificações de vendas da Hotmart (API 2.0.0)
router.post('/hotmart', async (req, res) => {
    const siteId = req.query.site_id;
    
    // Log para depuração
    console.log('[Webhook Hotmart] Recebido:', JSON.stringify(req.body));

    const site = await findActiveSite(siteId, res);
    if (!site) return; // findActiveSite já enviou a resposta de erro

    const eventName = req.body.event;
    if (!eventName) {
        return res.status(400).json({ error: 'Campo event é obrigatório no payload da Hotmart.' });
    }

    // Processa apenas compras aprovadas
    if (eventName.toUpperCase() !== 'PURCHASE_APPROVED') {
        return res.json({ success: true, message: `Evento '${eventName}' ignorado.` });
    }

    const data = req.body.data || {};
    const buyer = data.buyer || data.user || {};
    const purchase = data.purchase || {};
    const product = data.product || {};

    const name = buyer.name || buyer.nome;
    const email = buyer.email;
    const phone = buyer.checkout_phone || buyer.phone;
    const transactionId = purchase.transaction || req.body.id;
    const value = purchase.price ? purchase.price.value : undefined;
    const currency = purchase.price ? purchase.price.currency_code : 'BRL';
    const productName = product.name;

    if (!email) {
        return res.status(400).json({ error: 'E-mail do comprador não encontrado no payload.' });
    }

    const userData = {
        nome: name,
        email: email,
        telefone: phone,
        value: value ? parseFloat(value) : undefined,
        currency: currency ? String(currency).toUpperCase() : 'BRL',
        content_name: productName
    };

    const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Dispara Conversions API
    sendMetaCapiEvent({
        siteId: site.id,
        pixelId: site.meta_pixel_id,
        accessToken: site.meta_pixel_token,
        testEventCode: site.test_event_code,
        eventName: 'Purchase',
        eventId: transactionId,
        pageUrl: `https://${site.dominio}/checkout/hotmart`,
        clientIp,
        userAgent: req.headers['user-agent'] || 'Webhook-Hotmart-CAPI',
        cookies: {},
        userData
    }).catch(err => console.error('[CAPI Hotmart Webhook Error]', err));

    res.json({ success: true, message: 'Processamento do webhook da Hotmart iniciado.' });
});

// POST /api/webhooks/payt – Recebe notificações de vendas da Payt (Postbacks V1)
router.post('/payt', async (req, res) => {
    const siteId = req.query.site_id;

    // Log para depuração
    console.log('[Webhook Payt] Recebido:', JSON.stringify(req.body));

    const site = await findActiveSite(siteId, res);
    if (!site) return; // findActiveSite já enviou a resposta de erro

    // O status do postback do Payt costuma ser 'aprovada', 'finalizada', 'paid', 'approved', 'completed'
    const status = String(req.body.status || req.body.payment_status || '').toLowerCase();
    
    // Se o webhook não contiver status (ex: testes manuais vazios), podemos logar e rejeitar
    if (!status) {
        return res.status(400).json({ error: 'Campo status não encontrado no payload da Payt.' });
    }

    const isApproved = ['aprovada', 'finalizada', 'approved', 'paid', 'completed'].some(s => status.includes(s));
    
    if (!isApproved) {
        return res.json({ success: true, message: `Status '${status}' ignorado.` });
    }

    // Extração flexível dos campos de comprador
    const name = req.body.customer_name || req.body.full_name || req.body.nome || (req.body.customer && req.body.customer.name) || (req.body.client && req.body.client.name);
    const email = req.body.customer_email || req.body.email || (req.body.customer && req.body.customer.email) || (req.body.client && req.body.client.email);
    const phone = req.body.customer_phone || req.body.phone || req.body.celular || (req.body.customer && req.body.customer.phone) || (req.body.client && req.body.client.phone);

    // Extração flexível do produto e valores
    const transactionId = req.body.transaction_id || req.body.orid || req.body.transaction || req.body.id;
    const value = req.body.amount || req.body.value || req.body.valor || req.body.price;
    const currency = req.body.currency || req.body.moeda || 'BRL';
    const productName = req.body.product_name || req.body.product || req.body.nome_produto;

    if (!email) {
        return res.status(400).json({ error: 'E-mail do comprador não encontrado no payload da Payt.' });
    }

    const userData = {
        nome: name,
        email: email,
        telefone: phone,
        value: value ? parseFloat(value) : undefined,
        currency: currency ? String(currency).toUpperCase() : 'BRL',
        content_name: productName
    };

    const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Dispara Conversions API
    sendMetaCapiEvent({
        siteId: site.id,
        pixelId: site.meta_pixel_id,
        accessToken: site.meta_pixel_token,
        testEventCode: site.test_event_code,
        eventName: 'Purchase',
        eventId: transactionId,
        pageUrl: `https://${site.dominio}/checkout/payt`,
        clientIp,
        userAgent: req.headers['user-agent'] || 'Webhook-Payt-CAPI',
        cookies: {},
        userData
    }).catch(err => console.error('[CAPI Payt Webhook Error]', err));

    res.json({ success: true, message: 'Processamento do webhook da Payt iniciado.' });
});

module.exports = router;
