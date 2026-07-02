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
        deviceId: null,

        generateUUID: function() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        },

        setCookie: function(name, value, days) {
            var expires = "";
            if (days) {
                var date = new Date();
                date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
                expires = "; expires=" + date.toUTCString();
            }
            document.cookie = name + "=" + (value || "") + expires + "; path=/; SameSite=Lax";
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

        checkFbclid: function() {
            var match = window.location.search.match(/[?&]fbclid=([^&]+)/);
            if (match) {
                var fbclid = match[1];
                var cookies = this.getCookies();
                if (!cookies._fbc) {
                    var fbcValue = 'fb.1.' + Date.now() + '.' + fbclid;
                    this.setCookie('_fbc', fbcValue, 730);
                }
            }
        },

        checkFbp: function() {
            var cookies = this.getCookies();
            if (!cookies._fbp) {
                // Formato oficial do _fbp da Meta: fb.1.{timestamp_ms}.{rand_10_digitos}
                var rand = Math.floor(1000000000 + Math.random() * 9000000000);
                var fbpValue = 'fb.1.' + Date.now() + '.' + rand;
                this.setCookie('_fbp', fbpValue, 730);
            }
        },

        getStoredUserData: function() {
            try {
                var data = localStorage.getItem('_metaads_user_data');
                return data ? JSON.parse(data) : null;
            } catch (_) {
                return null;
            }
        },

        initDeviceId: function() {
            try {
                var devId = localStorage.getItem('_metaads_device_id');
                if (!devId) {
                    devId = this.generateUUID();
                    localStorage.setItem('_metaads_device_id', devId);
                }
                this.deviceId = devId;
            } catch (_) {
                this.deviceId = this.generateUUID();
            }
        },

        init: function(pixelId) {
            if (!pixelId) return;
            this.pixelId = pixelId;
            this.initDeviceId();
            this.checkFbclid();
            this.checkFbp();
            
            if (!window.fbq) {
                !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)}(window,document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');
            }

            var initOptions = {};
            if (this.deviceId) {
                initOptions.external_id = this.deviceId;
            }

            fbq('init', pixelId, initOptions);
            fbq('track', 'PageView');

            this.setupSPA();
            this.autoCaptureForms();
        },

        track: function(eventName, userData) {
            userData = userData || {};
            
            var storedData = this.getStoredUserData() || {};
            var mergedUserData = {};
            
            for (var k in storedData) {
                mergedUserData[k] = storedData[k];
            }
            for (var k in userData) {
                if (k !== 'customData') {
                    mergedUserData[k] = userData[k];
                }
            }
            if (!mergedUserData.userId && this.deviceId) {
                mergedUserData.userId = this.deviceId;
            }

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
                user_data: mergedUserData,
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
        },

        setupSPA: function() {
            var self = this;
            var lastUrl = window.location.href;
            
            function checkUrlChange() {
                if (window.location.href !== lastUrl) {
                    lastUrl = window.location.href;
                    self.track('PageView');
                }
            }
            
            window.addEventListener('popstate', checkUrlChange);
            window.addEventListener('hashchange', checkUrlChange);
            
            var originalPushState = history.pushState;
            if (originalPushState) {
                history.pushState = function() {
                    originalPushState.apply(this, arguments);
                    checkUrlChange();
                };
            }
            
            var originalReplaceState = history.replaceState;
            if (originalReplaceState) {
                history.replaceState = function() {
                    originalReplaceState.apply(this, arguments);
                    checkUrlChange();
                };
            }
        },

        autoCaptureForms: function() {
            var self = this;
            document.addEventListener('submit', function(e) {
                try {
                    var form = e.target;
                    var inputs = form.querySelectorAll('input, select');
                    var captured = {};
                    var hasData = false;
                    
                    for (var i = 0; i < inputs.length; i++) {
                        var input = inputs[i];
                        var name = (input.name || input.id || '').toLowerCase();
                        var type = (input.type || '').toLowerCase();
                        var value = (input.value || '').trim();
                        if (!value) continue;
                        
                        if (type === 'email' || name.indexOf('email') > -1 || name.indexOf('mail') > -1) {
                            captured.email = value;
                            hasData = true;
                        } else if (type === 'tel' || name.indexOf('phone') > -1 || name.indexOf('tel') > -1 || name.indexOf('fone') > -1 || name.indexOf('celular') > -1 || name.indexOf('whatsapp') > -1) {
                            captured.telefone = value;
                            hasData = true;
                        } else if (name.indexOf('nome') > -1 || name.indexOf('name') > -1) {
                            if (name.indexOf('first') > -1 || name.indexOf('prio') > -1) {
                                captured.firstName = value;
                            } else if (name.indexOf('last') > -1 || name.indexOf('sobrenome') > -1) {
                                captured.lastName = value;
                            } else {
                                captured.nome = value;
                            }
                            hasData = true;
                        } else if (name.indexOf('cidade') > -1 || name.indexOf('city') > -1) {
                            captured.cidade = value;
                            hasData = true;
                        } else if (name.indexOf('estado') > -1 || name.indexOf('state') > -1 || name.indexOf('uf') > -1) {
                            captured.estado = value;
                            hasData = true;
                        } else if (name.indexOf('cep') > -1 || name.indexOf('zip') > -1) {
                            captured.cep = value;
                            hasData = true;
                        }
                    }
                    
                    if (hasData) {
                        var existing = self.getStoredUserData() || {};
                        for (var key in captured) {
                            existing[key] = captured[key];
                        }
                        localStorage.setItem('_metaads_user_data', JSON.stringify(existing));
                    }
                } catch (err) {
                    console.warn('[Tracker] Form capture error:', err);
                }
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

        // 3. Obtém dados de conexão e geolocalização via cabeçalhos de proxy (Cloudflare/Vercel)
        const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const geoHeaders = {
            cidade: req.headers['cf-ipcity'] || req.headers['x-vercel-ip-city'],
            estado: req.headers['cf-region'] || req.headers['x-vercel-ip-country-region'],
            pais: req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country']
        };

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
            userData: user_data || {},
            geoHeaders
        }).catch(err => console.error('[CAPI Trigger Error]', err));

        // Retorna sucesso de processamento imediato
        res.json({ success: true });
    } catch (err) {
        console.error('[Track Route] Erro geral:', err);
        res.status(500).json({ error: 'Erro interno ao processar evento.' });
    }
});

module.exports = router;
