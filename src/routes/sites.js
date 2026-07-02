const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { v4: uuidv4 } = require('uuid');
const { sendMetaCapiEvent } = require('../services/metaCapi');

// LIST – Retorna todos os sites cadastrados
router.get('/', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM sites ORDER BY criado_em DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('[Admin Sites] Erro ao listar sites:', err);
        res.status(500).json({ error: 'Erro ao listar sites do banco.' });
    }
});

// LOGS GLOBAL – Retorna histórico de disparos unificado de todos os sites com filtros
router.get('/logs', async (req, res) => {
    const { site_id, status, search, limit = 50 } = req.query;
    
    let queryText = `
        SELECT el.*, s.nome as site_name, s.dominio as site_domain 
        FROM events_log el
        LEFT JOIN sites s ON el.site_id = s.id
        WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (site_id) {
        queryText += ` AND el.site_id = $${paramIndex}`;
        params.push(site_id);
        paramIndex++;
    }
    
    if (status) {
        queryText += ` AND el.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
    }
    
    if (search) {
        queryText += ` AND (el.event_name LIKE $${paramIndex} OR el.page_url LIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
    }
    
    queryText += ` ORDER BY el.criado_em DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));
    
    try {
        const result = await db.query(queryText, params);
        res.json(result.rows);
    } catch (err) {
        console.error('[Admin Logs] Erro ao buscar logs unificados:', err);
        res.status(500).json({ error: 'Erro ao buscar histórico de logs.' });
    }
});

// STATS – Retorna métricas globais e dados para o gráfico do painel
router.get('/stats', async (req, res) => {
    try {
        const sitesCountRes = await db.query('SELECT COUNT(*) as count FROM sites');
        const activeSitesRes = await db.query('SELECT COUNT(*) as count FROM sites WHERE ativo = TRUE');
        const totalEventsRes = await db.query('SELECT COUNT(*) as count FROM events_log');
        const successEventsRes = await db.query("SELECT COUNT(*) as count FROM events_log WHERE status = 'success'");
        
        const totalSites = parseInt(sitesCountRes.rows[0].count || sitesCountRes.rows[0]['COUNT(*)'] || 0);
        const activeSites = parseInt(activeSitesRes.rows[0].count || activeSitesRes.rows[0]['COUNT(*)'] || 0);
        const totalEvents = parseInt(totalEventsRes.rows[0].count || totalEventsRes.rows[0]['COUNT(*)'] || 0);
        const successEvents = parseInt(successEventsRes.rows[0].count || successEventsRes.rows[0]['COUNT(*)'] || 0);
        const failedEvents = totalEvents - successEvents;
        const successRate = totalEvents > 0 ? parseFloat(((successEvents / totalEvents) * 100).toFixed(2)) : 100.00;

        // Distribuição de tipos de eventos (PageView, Lead, etc)
        const eventTypesRes = await db.query('SELECT event_name, COUNT(*) as count FROM events_log GROUP BY event_name ORDER BY count DESC');
        const eventTypes = eventTypesRes.rows.map(row => ({
            name: row.event_name,
            count: parseInt(row.count || row.COUNT || 0)
        }));

        // Dados dos últimos 7 dias para gráfico
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const pad = (n) => String(n).padStart(2, '0');
        const dbDateString = `${sevenDaysAgo.getUTCFullYear()}-${pad(sevenDaysAgo.getUTCMonth() + 1)}-${pad(sevenDaysAgo.getUTCDate())} ${pad(sevenDaysAgo.getUTCHours())}:${pad(sevenDaysAgo.getUTCMinutes())}:${pad(sevenDaysAgo.getUTCSeconds())}`;

        const logs7DaysRes = await db.query('SELECT status, criado_em FROM events_log WHERE criado_em >= $1', [dbDateString]);

        const dailyStats = {};
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateKey = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
            dailyStats[dateKey] = { success: 0, failed: 0, total: 0 };
        }

        logs7DaysRes.rows.forEach(row => {
            const rowDate = new Date(row.criado_em);
            const dateKey = `${pad(rowDate.getDate())}/${pad(rowDate.getMonth() + 1)}`;
            if (dailyStats[dateKey]) {
                dailyStats[dateKey].total++;
                if (row.status === 'success') {
                    dailyStats[dateKey].success++;
                } else {
                    dailyStats[dateKey].failed++;
                }
            }
        });

        const dailyData = Object.keys(dailyStats).map(key => ({
            date: key,
            ...dailyStats[key]
        }));

        res.json({
            summary: {
                totalSites,
                activeSites,
                totalEvents,
                successEvents,
                failedEvents,
                successRate
            },
            eventTypes,
            dailyData
        });
    } catch (err) {
        console.error('[Admin Stats] Erro ao calcular estatísticas:', err);
        res.status(500).json({ error: 'Erro ao carregar estatísticas do painel.' });
    }
});

// PRUNE – Limpa logs mais antigos que 30 dias
router.post('/logs/prune', async (req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const pad = (n) => String(n).padStart(2, '0');
        const dbDateString = `${thirtyDaysAgo.getUTCFullYear()}-${pad(thirtyDaysAgo.getUTCMonth() + 1)}-${pad(thirtyDaysAgo.getUTCDate())} ${pad(thirtyDaysAgo.getUTCHours())}:${pad(thirtyDaysAgo.getUTCMinutes())}:${pad(thirtyDaysAgo.getUTCSeconds())}`;
        
        const result = await db.query('DELETE FROM events_log WHERE criado_em < $1', [dbDateString]);
        const deletedCount = result.rowCount || 0;
        
        res.json({
            success: true,
            deletedCount,
            message: `Logs mais antigos que ${thirtyDaysAgo.toLocaleDateString('pt-BR')} foram excluídos.`
        });
    } catch (err) {
        console.error('[Admin Prune] Erro ao limpar logs:', err);
        res.status(500).json({ error: 'Erro ao limpar logs antigos do banco.' });
    }
});

// GET ONE – Detalhes de um site específico
router.get('/:id', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM sites WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Site não encontrado.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[Admin Sites] Erro ao obter site:', err);
        res.status(500).json({ error: 'Erro ao carregar detalhes do site.' });
    }
});

// CREATE – Cadastra um novo site
router.post('/', async (req, res) => {
    const { nome, dominio, meta_pixel_id, meta_pixel_token, test_event_code } = req.body;

    if (!nome || !dominio || !meta_pixel_id || !meta_pixel_token) {
        return res.status(400).json({ error: 'Campos nome, dominio, meta_pixel_id e meta_pixel_token são obrigatórios.' });
    }

    const id = uuidv4();

    try {
        await db.query(
            `INSERT INTO sites (id, nome, dominio, meta_pixel_id, meta_pixel_token, test_event_code)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                id, 
                nome.trim(), 
                dominio.trim().replace('www.', '').toLowerCase(), 
                meta_pixel_id.trim(), 
                meta_pixel_token.trim(), 
                test_event_code ? test_event_code.trim() : null
            ]
        );
        res.status(201).json({ id, nome, dominio, success: true });
    } catch (err) {
        if (err.message.includes('UNIQUE') || err.message.includes('duplicate key')) {
            return res.status(409).json({ error: 'Já existe um site cadastrado com este domínio.' });
        }
        console.error('[Admin Sites] Erro ao cadastrar site:', err);
        res.status(500).json({ error: 'Erro ao cadastrar site no banco.' });
    }
});

// UPDATE – Atualiza configurações do site
router.put('/:id', async (req, res) => {
    const { nome, dominio, meta_pixel_id, meta_pixel_token, test_event_code, ativo } = req.body;

    if (!nome || !dominio || !meta_pixel_id || !meta_pixel_token) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
    }

    const cleanAtivo = ativo === false || ativo === 0 || ativo === 'false' ? false : true;

    try {
        const result = await db.query(
            `UPDATE sites 
             SET nome = $1, dominio = $2, meta_pixel_id = $3, meta_pixel_token = $4, test_event_code = $5, ativo = $6, atualizado_em = CURRENT_TIMESTAMP
             WHERE id = $7`,
            [
                nome.trim(),
                dominio.trim().replace('www.', '').toLowerCase(),
                meta_pixel_id.trim(),
                meta_pixel_token.trim(),
                test_event_code ? test_event_code.trim() : null,
                cleanAtivo,
                req.params.id
            ]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Site não encontrado para atualização.' });
        }

        res.json({ success: true, message: 'Configurações atualizadas com sucesso.' });
    } catch (err) {
        console.error('[Admin Sites] Erro ao atualizar site:', err);
        res.status(500).json({ error: 'Erro ao atualizar dados no banco.' });
    }
});

// DELETE – Remove um site do sistema
router.delete('/:id', async (req, res) => {
    try {
        const result = await db.query('DELETE FROM sites WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Site não encontrado para exclusão.' });
        }
        res.json({ success: true, message: 'Site removido com sucesso.' });
    } catch (err) {
        console.error('[Admin Sites] Erro ao deletar site:', err);
        res.status(500).json({ error: 'Erro ao deletar site do banco.' });
    }
});

// POST /api/sites/:id/test – Dispara um disparo de teste da CAPI para Meta
router.post('/:id/test', async (req, res) => {
    try {
        const siteResult = await db.query('SELECT * FROM sites WHERE id = $1', [req.params.id]);
        if (siteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Site não encontrado.' });
        }
        const site = siteResult.rows[0];

        const testEventCode = site.test_event_code || 'TEST' + Math.floor(10000 + Math.random() * 90000);
        
        const testRes = await sendMetaCapiEvent({
            siteId: site.id,
            pixelId: site.meta_pixel_id,
            accessToken: site.meta_pixel_token,
            testEventCode: testEventCode,
            eventName: 'PageView',
            eventId: 'test-' + uuidv4(),
            pageUrl: `https://${site.dominio}/test-connection`,
            clientIp: '127.0.0.1',
            userAgent: 'MetaAds Connection Test Client',
            cookies: {},
            userData: {
                email: 'test@metaadstracker.com',
                telefone: '5511999999999',
                nome: 'MetaAds Test Connection'
            }
        });

        let parsedResponse = {};
        try {
            parsedResponse = JSON.parse(testRes.response || '{}');
        } catch (_) {
            parsedResponse = { raw: testRes.response };
        }

        res.json({
            success: testRes.success,
            response: parsedResponse,
            test_event_code: testEventCode
        });
    } catch (err) {
        console.error('[Admin Test] Erro ao testar CAPI:', err);
        res.status(500).json({ error: 'Falha ao processar teste da CAPI.' });
    }
});

module.exports = router;
