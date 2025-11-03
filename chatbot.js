// =================================================================
// DEPENDÊNCIAS
// =================================================================
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

// =================================================================
// INICIALIZAÇÃO E CONFIGURAÇÕES
// =================================================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/usr/bin/chromium-browser', // caminho mais comum no Ubuntu 24
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
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

client.on('disconnected', (reason) => {
    console.log(`⚠️ Cliente desconectado: ${reason}`);
    console.log('Tentando reiniciar...');
    client.initialize();
});

client.initialize();

// =================================================================
// FUNÇÃO AUXILIAR (Delay e digitação)
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

    // LOG DIAGNÓSTICO
    if (['!bot_desativar', '!bot_transferir', '!bot_reativar'].includes(msgBody)) {
        console.log('----------------------------------------------------');
        console.log(`[DIAGNÓSTICO] Comando detectado: ${msgBody}`);
        console.log(`msg.to (Cliente): ${msg.to}`);
        console.log(`Status do cliente ANTES: ${userStates[userId] || 'NÃO ENCONTRADO'}`);
        console.log('----------------------------------------------------');
    }

    if (['!bot_desativar', '!bot_transferir'].includes(msgBody)) {
        userStates[userId] = 'aguardando_humano';
        await sendTypingMessage(userId, '👩‍⚕️ Um atendente assumiu a conversa agora e irá te responder em instantes.', 1500);
        await client.sendMessage(userId, '✅ Bot silenciado. Use *!bot_reativar* ao finalizar.');
        console.log(`[BOT] Desativado para ${userId}`);
        return;
    }

    if (msgBody === '!bot_reativar') {
        if (userStates[userId] === 'aguardando_humano') {
            delete userStates[userId];
            await sendTypingMessage(userId, '🤖 Olá! A conversa com a recepção foi finalizada. Digite *Menu* para ver as opções novamente.', 2000);
            console.log(`[BOT] Reativado para ${userId}`);
        } else {
            await client.sendMessage(userId, '❌ O bot não estava desativado para esse cliente.');
        }
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

    if (state === 'aguardando_dados_consulta') {
        await sendTypingMessage(user, 'Obrigado pelas informações! 👍');
        await sendTypingMessage(user, 'Nossa equipe vai confirmar seu agendamento em breve.');
        await sendTypingMessage(user, `Recebemos: "${msg.body}"`);
        delete userStates[user];
        return;
    }

    if (state === 'aguardando_humano') return;

    // ======== INÍCIO OU MENU ========
    if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|menu|voltar|ajuda|iniciar)$/i.test(msgBody)) {
        const contact = await msg.getContact();
        const name = contact.pushname || "Tutor(a)";
        await sendTypingMessage(user, `Olá ${name.split(" ")[0]} 👋 Sou o assistente virtual da VetClin 👩‍⚕️.`);

        const menuTexto = `Como posso ajudá-lo hoje? Digite o número da opção desejada:
*1 - 📅 Agendar Consulta*
*2 - 💉 Informações sobre Vacinas*
*3 - 🔬 Informações sobre Exames*
*4 - 📍 Localização e Horários*
*5 - 👩‍⚕️ Falar com Atendente*
*6 - 🚨 Emergência*`;
        await sendTypingMessage(user, menuTexto, 2000);
        delete userStates[user];
        return;
    }

    // ======== OPÇÕES DO MENU ========
    switch (msgBody) {
        case '1':
            await sendTypingMessage(user, 'Ok, vamos agendar uma consulta. 😊');
            await client.sendMessage(user, `1️⃣ Nome do tutor\n2️⃣ Nome e espécie do pet\n3️⃣ Motivo da consulta\n4️⃣ Melhor dia e horário`);
            await sendTypingMessage(user, 'Envie todas as informações em uma única mensagem.', 1500);
            userStates[user] = 'aguardando_dados_consulta';
            break;

        case '2':
            await sendTypingMessage(user, '💉 *Vacinas Disponíveis*:\n\n🐶 *Cães*\n• Polivalente: R$60–70\n• Antirrábica: R$30\n• Gripe Canina: R$90\n\n🐱 *Gatos*\n• Feline 1: R$100\n• Feline + FELV: R$150\n\n⚠️ Reforço FELV exige teste prévio.');
            await sendTypingMessage(user, 'Digite *1* para agendar vacinação ou *Menu* para voltar.');
            break;

        case '3':
            await sendTypingMessage(user, '🔬 *Exames disponíveis*: Hemograma, bioquímicos, raio-x, ultrassom, endoscopia, testes rápidos e muito mais.');
            await sendTypingMessage(user, 'Exames são realizados mediante consulta veterinária ou pedido profissional.');
            await sendTypingMessage(user, 'Digite *1* para agendar consulta ou *Menu* para voltar.');
            break;

        case '4':
            await sendTypingMessage(user, '🏥 *VetClin*\nAv. Joaquim Aires, 2301 - Centro, Porto Nacional - TO\n📍 https://share.google/KtFwbdJXQ8AVloaJD');
            await client.sendMessage(user, '🕐 Horário: Seg–Sex 8h–18h | Sáb 8h–12h\n🚨 Emergências 24h');
            await sendTypingMessage(user, 'Digite *Menu* para voltar.');
            break;

        case '5':
            await sendTypingMessage(user, '👩‍⚕️ Transferindo para um atendente humano. Aguarde um instante...');
            userStates[user] = 'aguardando_humano';
            break;

        case '6':
            await sendTypingMessage(user, '🚨 *EMERGÊNCIA* 🚨\nLigue agora: (63) 99114-0858');
            await client.sendMessage(user, '📍 Endereço:\nAv. Joaquim Aires, 2301 - Centro, Porto Nacional - TO');
            userStates[user] = 'aguardando_humano';
            break;

        default:
            await sendTypingMessage(user, 'Desculpe, não entendi. 🤔');
            await sendTypingMessage(user, 'Digite *Menu* para ver as opções disponíveis.');
            break;
    }
});
// =================================================================
// DEPENDÊNCIAS
// =================================================================
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

// =================================================================
// INICIALIZAÇÃO E CONFIGURAÇÕES
// =================================================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/usr/bin/chromium-browser', // caminho mais comum no Ubuntu 24
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
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

client.on('disconnected', (reason) => {
    console.log(`⚠️ Cliente desconectado: ${reason}`);
    console.log('Tentando reiniciar...');
    client.initialize();
});

client.initialize();

// =================================================================
// FUNÇÃO AUXILIAR (Delay e digitação)
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

    // LOG DIAGNÓSTICO
    if (['!bot_desativar', '!bot_transferir', '!bot_reativar'].includes(msgBody)) {
        console.log('----------------------------------------------------');
        console.log(`[DIAGNÓSTICO] Comando detectado: ${msgBody}`);
        console.log(`msg.to (Cliente): ${msg.to}`);
        console.log(`Status do cliente ANTES: ${userStates[userId] || 'NÃO ENCONTRADO'}`);
        console.log('----------------------------------------------------');
    }

    if (['!bot_desativar', '!bot_transferir'].includes(msgBody)) {
        userStates[userId] = 'aguardando_humano';
        await sendTypingMessage(userId, '👩‍⚕️ Um atendente assumiu a conversa agora e irá te responder em instantes.', 1500);
        await client.sendMessage(userId, '✅ Bot silenciado. Use *!bot_reativar* ao finalizar.');
        console.log(`[BOT] Desativado para ${userId}`);
        return;
    }

    if (msgBody === '!bot_reativar') {
        if (userStates[userId] === 'aguardando_humano') {
            delete userStates[userId];
            await sendTypingMessage(userId, '🤖 Olá! A conversa com a recepção foi finalizada. Digite *Menu* para ver as opções novamente.', 2000);
            console.log(`[BOT] Reativado para ${userId}`);
        } else {
            await client.sendMessage(userId, '❌ O bot não estava desativado para esse cliente.');
        }
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

    if (state === 'aguardando_dados_consulta') {
        await sendTypingMessage(user, 'Obrigado pelas informações! 👍');
        await sendTypingMessage(user, 'Nossa equipe vai confirmar seu agendamento em breve.');
        await sendTypingMessage(user, `Recebemos: "${msg.body}"`);
        delete userStates[user];
        return;
    }

    if (state === 'aguardando_humano') return;

    // ======== INÍCIO OU MENU ========
    if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|menu|voltar|ajuda|iniciar)$/i.test(msgBody)) {
        const contact = await msg.getContact();
        const name = contact.pushname || "Tutor(a)";
        await sendTypingMessage(user, `Olá ${name.split(" ")[0]} 👋 Sou o assistente virtual da VetClin 👩‍⚕️.`);

        const menuTexto = `Como posso ajudá-lo hoje? Digite o número da opção desejada:
*1 - 📅 Agendar Consulta*
*2 - 💉 Informações sobre Vacinas*
*3 - 🔬 Informações sobre Exames*
*4 - 📍 Localização e Horários*
*5 - 👩‍⚕️ Falar com Atendente*
*6 - 🚨 Emergência*`;
        await sendTypingMessage(user, menuTexto, 2000);
        delete userStates[user];
        return;
    }

    // ======== OPÇÕES DO MENU ========
    switch (msgBody) {
        case '1':
            await sendTypingMessage(user, 'Ok, vamos agendar uma consulta. 😊');
            await client.sendMessage(user, `1️⃣ Nome do tutor\n2️⃣ Nome e espécie do pet\n3️⃣ Motivo da consulta\n4️⃣ Melhor dia e horário`);
            await sendTypingMessage(user, 'Envie todas as informações em uma única mensagem.', 1500);
            userStates[user] = 'aguardando_dados_consulta';
            break;

        case '2':
            await sendTypingMessage(user, '💉 *Vacinas Disponíveis*:\n\n🐶 *Cães*\n• Polivalente: R$60–70\n• Antirrábica: R$30\n• Gripe Canina: R$90\n\n🐱 *Gatos*\n• Feline 1: R$100\n• Feline + FELV: R$150\n\n⚠️ Reforço FELV exige teste prévio.');
            await sendTypingMessage(user, 'Digite *1* para agendar vacinação ou *Menu* para voltar.');
            break;

        case '3':
            await sendTypingMessage(user, '🔬 *Exames disponíveis*: Hemograma, bioquímicos, raio-x, ultrassom, endoscopia, testes rápidos e muito mais.');
            await sendTypingMessage(user, 'Exames são realizados mediante consulta veterinária ou pedido profissional.');
            await sendTypingMessage(user, 'Digite *1* para agendar consulta ou *Menu* para voltar.');
            break;

        case '4':
            await sendTypingMessage(user, '🏥 *VetClin*\nAv. Joaquim Aires, 2301 - Centro, Porto Nacional - TO\n📍 https://share.google/KtFwbdJXQ8AVloaJD');
            await client.sendMessage(user, '🕐 Horário: Seg–Sex 8h–18h | Sáb 8h–12h\n🚨 Emergências 24h');
            await sendTypingMessage(user, 'Digite *Menu* para voltar.');
            break;

        case '5':
            await sendTypingMessage(user, '👩‍⚕️ Transferindo para um atendente humano. Aguarde um instante...');
            userStates[user] = 'aguardando_humano';
            break;

        case '6':
            await sendTypingMessage(user, '🚨 *EMERGÊNCIA* 🚨\nLigue agora: (63) 99114-0858');
            await client.sendMessage(user, '📍 Endereço:\nAv. Joaquim Aires, 2301 - Centro, Porto Nacional - TO');
            userStates[user] = 'aguardando_humano';
            break;

        default:
            await sendTypingMessage(user, 'Desculpe, não entendi. 🤔');
            await sendTypingMessage(user, 'Digite *Menu* para ver as opções disponíveis.');
            break;
    }
});
