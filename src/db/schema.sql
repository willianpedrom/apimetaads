-- Tabela de Sites Cadastrados
CREATE TABLE IF NOT EXISTS sites (
    id VARCHAR(50) PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    dominio VARCHAR(255) UNIQUE NOT NULL,
    meta_pixel_id VARCHAR(50) NOT NULL,
    meta_pixel_token TEXT NOT NULL,
    test_event_code VARCHAR(50),
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de Logs de Eventos CAPI (Match Quality Monitor)
CREATE TABLE IF NOT EXISTS events_log (
    id VARCHAR(50) PRIMARY KEY,
    site_id VARCHAR(50),
    event_name VARCHAR(50) NOT NULL,
    event_id VARCHAR(50) NOT NULL,
    page_url TEXT,
    status VARCHAR(20) NOT NULL, -- 'success' ou 'failed'
    response_body TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para melhorar a performance de consultas e relatórios
CREATE INDEX IF NOT EXISTS idx_events_log_site_criado ON events_log(site_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_events_log_criado ON events_log(criado_em DESC);

