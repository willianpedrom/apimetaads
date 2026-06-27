const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { v4: uuidv4 } = require('uuid');

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

// LOGS – Retorna os últimos 50 disparos de eventos CAPI deste site
router.get('/:id/logs', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT * FROM events_log 
             WHERE site_id = $1 
             ORDER BY criado_em DESC 
             LIMIT 50`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[Admin Logs] Erro ao carregar logs:', err);
        res.status(500).json({ error: 'Erro ao carregar logs do banco.' });
    }
});

module.exports = router;
