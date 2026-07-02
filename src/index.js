require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const runSetup = require('./db/setup');

const app = express();
const PORT = process.env.PORT || 3002;

// Middlewares
app.use(cors({
    origin: '*', // Permite que qualquer site externo envie dados de rastreamento
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rota estática para o painel administrativo
app.use(express.static(path.join(__dirname, '../public')));

// Rotas do Rastreamento e Tracker Dinâmico (disponíveis na raiz e via API)
const eventsRouter = require('./routes/events');
app.use('/', eventsRouter); // tracker.js na raiz

// Rotas de Administração (Configurações dos Sites)
const sitesRouter = require('./routes/sites');
app.use('/api/sites', sitesRouter);

// Rota de Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', uptime: process.uptime() });
});

// Middleware de tratamento de erros global
app.use((err, req, res, next) => {
    console.error('[App Error]', err);
    res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
});

const db = require('./db/pool');

// Inicializa banco de dados e inicia o servidor
async function startServer() {
    console.log('🚀 Inicializando apimetaads...');
    await runSetup();
    
    // Auto-prune: Limpa logs com mais de 30 dias na inicialização
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const pad = (n) => String(n).padStart(2, '0');
        const dbDateString = `${thirtyDaysAgo.getUTCFullYear()}-${pad(thirtyDaysAgo.getUTCMonth() + 1)}-${pad(thirtyDaysAgo.getUTCDate())} ${pad(thirtyDaysAgo.getUTCHours())}:${pad(thirtyDaysAgo.getUTCMinutes())}:${pad(thirtyDaysAgo.getUTCSeconds())}`;
        
        const pruneRes = await db.query('DELETE FROM events_log WHERE criado_em < $1', [dbDateString]);
        console.log(`🧹 Auto-prune: ${pruneRes.rowCount || 0} logs antigos apagados.`);
    } catch (pruneErr) {
        console.error('⚠️ Falha ao executar auto-prune:', pruneErr.message);
    }
    
    app.listen(PORT, () => {
        console.log(`📡 Servidor rodando na porta ${PORT} no modo ${process.env.NODE_ENV || 'development'}`);
    });
}

startServer();
