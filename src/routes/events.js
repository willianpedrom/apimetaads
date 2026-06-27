const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { sendMetaCapiEvent } = require('../services/metaCapi');

// Template do tracker.js injetável
const trackerTemplate = `(function() {
    var scriptTag = document.currentScript;
    var siteId = scriptTag ? scriptTag.getAttribute('data-site-id') : null;

    if (window.TrackSystem) return;

    window.TrackSystem = {
        siteId: siteId,
        apiUrl: '{{API_URL}}',
        pixelId: null,

        generateUUID: function() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        },

        getCookies: function() {
            var cookies = {};
            document.cookie.split(';').forEach(function(cookie) {
                var parts = cookie.split('=');
                var name = parts[0].trim();
                if (name === '_fbp' || name === '_fbc') {
                    cookies[name] = parts[1] ? parts[1].trim() : '';
                }
            });
            return cookies;
        },

        init: function(pixelId) {
            if (!pixelId) return;
            this.pixelId = pixelId;
            
            if (!window.fbq) {
                !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)}(window,document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');
            }

            fbq('init', pixelId);
            fbq('track', 'PageView');
        },

        track: function(eventName, userData) {
            userData = userData || {};
            var eventId = this.generateUUID();
            var pageUrl = window.location.href;

            // 1. Browser-side Meta Pixel
            if (window.fbq && this.pixelId) {
                fbq('track', eventName, userData.customData || {}, { 
                    eventID: eventId 
                });
            }

            // 2. Server-side Conversions API (CAPI)
            var payload = {
                site_key: this.siteId,
                event_name: eventName,
                event_id: eventId,
                page_url: pageUrl,
                user_data: userData,
                cookies: this.getCookies()
            };

            fetch(this.apiUrl + '/api/events/track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true
            }).catch(function(err) {
                console.warn('[Tracker] CAPI call failed:', err);
            });
        }
    };

    // Auto-inicializa se o site-id for fornecido na tag script
    if (siteId) {
        fetch(window.TrackSystem.apiUrl + '/api/events/config?id=' + siteId)
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data && data.meta_pixel_id) {
                    window.TrackSystem.init(data.meta_pixel_id);
                }
            })
            .catch(function(err) {
                console.error('[Tracker] Error loading config:', err);
            });
    }
})();`;

// GET /tracker.js – Serve o script do cliente compilado com o domínio correto da API
router.get('/tracker.js', (req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const apiUrl = `${protocol}://${host}`;
    
    const jsContent = trackerTemplate.replace('{{API_URL}}', apiUrl);
    
    res.setHeader('Content-Type', 'application/javascript');
    res.send(jsContent);
});

// GET /api/events/config – Consulta pública e segura do Pixel ID (não expõe o token CAPI)
router.get('/api/events/config', async (req, res) => {
    const siteId = req.query.id;
    if (!siteId) {
        return res.status(400).json({ error: 'Parâmetro ID é obrigatório.' });
    }

    try {
        const result = await db.query('SELECT meta_pixel_id, ativo FROM sites WHERE id = $1', [siteId]);
        if (result.rows.length === 0 || !result.rows[0].ativo) {
            return res.status(404).json({ error: 'Configuração não encontrada ou inativa.' });
        }
        res.json({ meta_pixel_id: result.rows[0].meta_pixel_id });
    } catch (err) {
        console.error('[Config API] Erro ao buscar pixel:', err);
        res.status(500).json({ error: 'Erro no servidor.' });
    }
});

// POST /api/events/track – Recebe os dados de rastreamento do navegador e envia via CAPI
router.post('/api/events/track', async (req, res) => {
    const { site_key, event_name, event_id, page_url, user_data, cookies } = req.body;

    if (!event_name) {
        return res.status(400).json({ error: 'Nome do evento é obrigatório.' });
    }

    try {
        let site = null;
        
        // 1. Tenta identificar o site pela chave explícita
        if (site_key) {
            const result = await db.query('SELECT * FROM sites WHERE id = $1 AND ativo = TRUE', [site_key]);
            if (result.rows.length > 0) {
                site = result.rows[0];
            }
        }
        
        // 2. Se não encontrou pela chave, tenta identificar pelo domínio no cabeçalho referer/origin
        if (!site) {
            const referer = req.headers.referer || req.headers.origin;
            if (referer) {
                try {
                    const urlObj = new URL(referer);
                    const domain = urlObj.hostname.replace('www.', '').toLowerCase();
                    const result = await db.query('SELECT * FROM sites WHERE dominio = $1 AND ativo = TRUE', [domain]);
                    if (result.rows.length > 0) {
                        site = result.rows[0];
                    }
                } catch (_) {
                    // Ignora erros de parse de URL mal formatada
                }
            }
        }

        if (!site) {
            return res.status(404).json({ error: 'Site não configurado ou inativo.' });
        }

        // 3. Obtém dados de conexão
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];

        // 4. Executa o envio CAPI assincronamente (não bloqueia a resposta HTTP)
        sendMetaCapiEvent({
            siteId: site.id,
            pixelId: site.meta_pixel_id,
            accessToken: site.meta_pixel_token,
            testEventCode: site.test_event_code,
            eventName: event_name,
            eventId: event_id,
            pageUrl: page_url || req.headers.referer,
            clientIp,
            userAgent,
            cookies: cookies || {},
            userData: user_data || {}
        }).catch(err => console.error('[CAPI Trigger Error]', err));

        // Retorna sucesso de processamento imediato
        res.json({ success: true });
    } catch (err) {
        console.error('[Track Route] Erro geral:', err);
        res.status(500).json({ error: 'Erro interno ao processar evento.' });
    }
});

module.exports = router;
