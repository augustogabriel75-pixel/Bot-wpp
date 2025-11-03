// =================================================================
// DEPENDÊNCIAS
// =================================================================
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

// =================================================================
// INICIALIZAÇÃO E CONFIGURAÇÕES (OTIMIZADAS PARA VPS)
// =================================================================
const client = new Client({
    // ⚠️ CRÍTICO: Isola a sessão na pasta 'sessions' para evitar corrupção na Home
    authStrategy: new LocalAuth({
        dataPath: './sessions' 
    }),
    puppeteer: {
        // Caminho do Chromium, conforme a instalação no Ubuntu
        executablePath: '/usr/bin/chromium-browser', 
        headless: true,
        args: [
            // Argumentos CRÍTICOS para VPSs de baixa memória:
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Usa espaço em disco em vez de RAM para memória compartilhada
            '--no-zygote',             // Reduz falhas em ambientes Linux headless
            '--single-process',        // Aumenta estabilidade, reduz consumo
            '--no-sandbox-and-elevated-privileges', // Essencial para o ambiente systemd/pm2
            
            // Outras otimizações
            '--disable-gpu',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-software-rasterizer',
            '--window-size=1920,1080'
        ]
    }
});

// =================================================================
// EVENTOS PRINCIPAIS
// =================================================================
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Tudo certo! WhatsApp conectado e bot em execução.');
});

// Tratamento de desconexão: essencial para o PM2
client.on('disconnected', (reason) => {
    console.log(`⚠️ Cliente desconectado: ${reason}`);
    // O PM2 fará o restart do processo, não precisamos do initialize() aqui.
});

client.initialize();

// =================================================================
// FUNÇÃO AUXILIAR (Delay e digitação)
// =================================================================
const delay = ms => new Promise(res => setTimeout(res, ms));

async function sendTypingMessage(to, text, delayMs = 2500) {
    try {
        const chat = await client.getChatById(to);
        await chat.sendStateTyping();
        await delay(delayMs);
        await client.sendMessage(to, text);
        await chat.clearState();
    } catch (err) {
        console.error('Erro ao enviar mensagem:', err.message);
    }
}

// =================================================================
// 1. GERENCIADOR DE ESTADO (MEMÓRIA)
// =================================================================
const userStates = {};

// =================================================================
// 2. EVENTO: message_create (mensagens enviadas por VOCÊ)
// =================================================================
client.on('message_create', async msg => {
    if (!msg.fromMe) return;
    const msgBody = msg.body.trim().toLowerCase();
    const userId = msg.to;

    // Ações de desativação/transferência
    if (['!bot_desativar', '!bot_transferir'].includes(msgBody)) {
        userStates[userId] = 'aguardando_humano';
        // Envio da mensagem principal
        await client.sendMessage(userId, '👩‍⚕️ Um atendente assumiu a conversa agora e irá te responder em instantes.');
        // Envio da confirmação silenciosa
        await client.sendMessage(userId, '✅ Bot silenciado. Use *!bot_reativar* ao finalizar.');
        console.log(`[BOT] Desativado para ${userId}`);
        return;
    }

    if (msgBody === '!bot_reativar') {
        if (userStates[userId] === 'aguardando_humano') {
            delete userStates[userId];
            await client.sendMessage(userId, '🤖 Olá! A conversa com a recepção foi finalizada. Digite *Menu* para ver as opções novamente.');
            console.log(`[BOT] Reativado para ${userId}`);
        } else {
            await client.sendMessage(userId, '❌ O bot não estava desativado para esse cliente.');
        }
    }
    
    // Log para comandos de diagnóstico
    if (['!bot_desativar', '!bot_transferir', '!bot_reativar'].includes(msgBody)) {
        console.log('----------------------------------------------------');
        console.log(`[DIAGNÓSTICO] Comando detectado: ${msgBody}`);
        console.log(`Status do cliente APÓS: ${userStates[userId] || 'NÃO ENCONTRADO'}`);
        console.log('----------------------------------------------------');
    }
});

// =================================================================
// 3. EVENTO: message (mensagens RECEBIDAS)
// =================================================================
client.on('message', async msg => {
    if (msg.fromMe || !msg.from.endsWith('@c.us')) return;
    if (!msg.body && !msg.hasMedia) return;

    const msgBody = msg.body.trim().toLowerCase();
    const user = msg.from;
    const state = userStates[user];

    // Se estiver aguardando o humano ou dados de consulta
    if (state === 'aguardando_humano') return;

    if (state === 'aguardando_dados_consulta') {
        await sendTypingMessage(user, 'Obrigado pelas informações! 👍');
        await sendTypingMessage(user, 'Nossa equipe vai confirmar seu agendamento em breve.');
        await sendTypingMessage(user, `Recebemos: "${msg.body}"`);
        delete userStates[user];
        return;
    }

    // ======== INÍCIO OU MENU ========
    if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|menu|voltar|ajuda|iniciar)$/i.test(msgBody
