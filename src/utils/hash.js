const crypto = require('crypto');

/**
 * Normaliza e gera hash SHA-256 para dados sensíveis.
 * Converte para minúsculas, remove espaços antes e depois do texto.
 */
function hashData(data) {
    if (!data) return undefined;
    const cleanData = String(data).trim().toLowerCase();
    return crypto.createHash('sha256').update(cleanData).digest('hex');
}

/**
 * Normaliza número de telefone para o padrão internacional E.164
 * (apenas números, incluindo código do país, ex: 5511999999999)
 * e gera o hash SHA-256.
 */
function normalizePhone(phone) {
    if (!phone) return undefined;
    
    // Remove tudo que não for dígito
    let clean = String(phone).replace(/\D/g, '');
    
    // Se tiver 10 ou 11 dígitos, assume Brasil e adiciona DDI 55
    if (clean.length === 10 || clean.length === 11) {
        clean = '55' + clean;
    }
    
    return hashData(clean);
}

module.exports = {
    hashData,
    normalizePhone
};
