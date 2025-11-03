// =================================================================
// INICIALIZAÇÃO E CONFIGURAÇÕES
// =================================================================
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal'); 

const client = new Client({
    puppeteer: {
        // 🚨 CORREÇÃO CRÍTICA APLICADA AQUI:
        // O Puppeteer usará o Chromium instalado via apt/dpkg, que é o padrão para VPS Linux.
        // O caminho '/usr/bin/chromium-browser' é o correto para a maioria dos sistemas Ubuntu/Debian.
        executablePath: '/usr/bin/chromium-browser', 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-gpu' // Adicionado para melhor desempenho em VPS
        ]
    }
});

client.on('qr', qr => {
    qrcode.generate(qr, {small: true});
});

client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado.');
});

client.initialize();

// Função que usamos para criar o delay entre uma ação e outra
const delay = ms => new Promise(res => setTimeout(res, ms)); 

// =================================================================
// 1. NOSSA "MEMÓRIA" (Gerenciador de Estado)
// =================================================================
// Guarda o "estágio" da conversa de cada usuário.
const userStates = {};

// =================================================================
// 2. FUNÇÃO AUXILIAR (Código Limpo)
// =================================================================
/**
 * Simula digitação e envia uma mensagem
 * @param {string} to - O número do usuário (ex: msg.from)
 * @param {string} text - O texto a ser enviado
 * @param {number} [delayMs=2500] - O tempo de "digitação"
 */
async function sendTypingMessage(to, text, delayMs = 2500) {
    const chat = await client.getChatById(to);
    await chat.sendStateTyping();
    await delay(delayMs);
    await client.sendMessage(to, text);
    // Para a digitação
    await chat.clearState(); 
}

// =================================================================
// 3. COMANDOS INTERNOS DE CONTROLE (message_create)
// Este evento lê MENSAGENS ENVIADAS POR VOCÊ (o bot/atendente).
// =================================================================
client.on('message_create', async msg => {
    
    // Filtra apenas as mensagens enviadas por VOCÊ (o bot/atendente)
    if (!msg.fromMe) return;

    // Remove espaços e coloca em minúsculas
    const msgBody = msg.body.trim().toLowerCase(); 
    
    // USANDO msg.to: A chave do destinatário (o cliente) quando você envia.
    const userId = msg.to;

    // --- LOG DE DIAGNÓSTICO (MANTIDO PARA CONFERÊNCIA) ---
    if (msgBody === '!bot_desativar' || msgBody === '!bot_transferir' || msgBody === '!bot_reativar') {
        console.log('----------------------------------------------------');
        console.log(`[DIAGNÓSTICO] Comando detectado: ${msgBody}`);
        console.log(`msg.from (DE - Seu número): ${msg.from}`);
        console.log(`msg.to (PARA - Cliente): ${msg.to}`);
        console.log(`Status do cliente ANTES: ${userStates[userId] || 'NÃO ENCONTRADO'}`);
        console.log('----------------------------------------------------');
    }
    
    // 1. Comando de DESATIVAÇÃO/TRANSFERÊNCIA MANUAL (SILÊNCIO IMEDIATO)
    if (msgBody === '!bot_desativar' || msgBody === '!bot_transferir') {
        
        // Define o estado para AGUARDANDO_HUMANO (silencia o bot no funil principal)
        userStates[userId] = 'aguardando_humano';
        
        // 1. ENVIA UMA CONFIRMAÇÃO CONVERSACIONAL AO CLIENTE
        await sendTypingMessage(userId, '👩‍⚕️ Olá! Um de nossos atendentes assumiu a conversa agora e irá te responder em instantes.', 1500); 

        // 2. ENVIA UMA CONFIRMAÇÃO TÉCNICA APENAS PARA VOCÊ
        await client.sendMessage(userId, '✅ Comando aceito. O bot está silenciado. Use *!bot_reativar* ao finalizar.');
        
        console.log(`[message_create] Bot desativado com sucesso para: ${userId}`);
        return;
    }

    // 2. Comando de REATIVAÇÃO
    if (msgBody === '!bot_reativar') {
        
        if (userStates[userId] === 'aguardando_humano') {
            
            // 1. LIMPA O ESTADO
            delete userStates[userId];
            
            // 2. ENVIA A CONFIRMAÇÃO AO CLIENTE
            await sendTypingMessage(userId, '🤖 Olá! A conversa com a nossa recepção foi finalizada. Se tiver mais alguma dúvida, digite *Menu* para ver as opções novamente.', 2000);
            
            console.log(`[message_create] Bot reativado com sucesso para o ID: ${userId}`);
            
        } else {
             await client.sendMessage(userId, '❌ O bot não foi reativado. O cliente não estava no estado "aguardando_humano".'); 
             console.log(`[message_create] Reativação ignorada: Cliente ${userId} não estava em 'aguardando_humano' ou estado não existe.`);
        }
        return;
    }
});


// =================================================================
// 4. O FUNIL PRINCIPAL (message) 
// =================================================================
client.on('message', async msg => {

    // =========================================================
    // FILTROS DE MENSAGEM (Prioridade Máxima)
    // =========================================================

    // 1. IGNORA MENSAGENS ENVIADAS POR VOCÊ (tratadas no message_create)
    if (msg.fromMe) return;
    
    // 2. Ignora mensagens de grupo e outros tipos de mídia (mantém apenas conversas individuais)
    if (!msg.from.endsWith('@c.us')) return;

    // 3. Ignora mensagens que são apenas CITAÇÕES ou MÍDIAS (audio, foto, sticker, etc.)
    if (!msg.body && !msg.hasMedia) return;


    // Pegamos a mensagem, removemos espaços nas pontas e colocamos TUDO em minúsculas
    const msgBody = msg.body.trim().toLowerCase(); 

    // A partir daqui, todas as mensagens são do CLIENTE.
    const user = msg.from; 
    const state = userStates[user]; 


    // ----- ETAPA 1: VERIFICAR O ESTADO ATUAL (FLUXOS ABERTOS) -----

    // Se o bot estava aguardando os dados da consulta...
    if (state === 'aguardando_dados_consulta') {
        await sendTypingMessage(user, 'Obrigado pelas informações! 👍');
        await sendTypingMessage(user, 'Nossa equipe de recepção irá analisar os dados e confirmar seu agendamento por aqui em breve.');
        await sendTypingMessage(user, `Só para confirmar, recebemos:\n\n"${msg.body}"\n\nVamos verificar a agenda e já te retornamos. Se precisar de algo mais, só digitar *Menu*.`);
        
        // Limpa o estado do usuário
        delete userStates[user];
        return; 
    }

    // SE ESTIVER EM ESTADO DE SILÊNCIO (aguardando_humano), O BOT FAZ NADA.
    if (state === 'aguardando_humano') {
        return; 
    }


    // ----- ETAPA 2: VERIFICAR TRIGGERS (Início ou Menu) -----
    if (msgBody.match(/^(oi|olá|ola|bom dia|boa tarde|boa noite|menu|voltar|ajuda|iniciar)$/i)) {
        
        const contact = await msg.getContact();
        const name = contact.pushname || "Tutor(a)"; 
        
        await sendTypingMessage(user, `Olá! ${name.split(" ")[0]} 👋 Sou o assistente virtual da VetClin👩‍⚕️.`);

        const menuTexto = `Como posso ajudá-lo hoje? Por favor, *digite o número* da opção desejada:

*1 - 📅 Agendar Consulta*
*2 - 💉 Informações sobre Vacinas*
*3 - 🔬 Informações sobre Exames*
*4 - 📍 Localização e Horários*
*5 - 👩‍⚕️ Falar com Atendente*
*6 - 🚨 EMERGÊNCIA*`;

        await sendTypingMessage(user, menuTexto, 2000); 
        
        if (userStates[user]) delete userStates[user];
        return;
    }


    // ----- ETAPA 3: TRATAR AS ESCOLHAS DO MENU (Comandos Numéricos) -----
    
    // Opção 1: AGENDAR CONSULTA
    if (msgBody === '1') {
        await sendTypingMessage(user, 'Ok, vamos agendar uma consulta. 😊\n\nPara isso, precisamos de algumas informações rápidas:');
        
        const textoConsulta = `1️⃣ Nome completo do tutor
2️⃣ Nome e espécie do pet (ex: cão, gato...)
3️⃣ Motivo da consulta
4️⃣ Melhor dia e horário para o atendimento`;
        
        await client.sendMessage(user, textoConsulta); 
        
        await sendTypingMessage(user, 'Por favor, *envie todas as informações em uma única mensagem*. Nossa equipe vai verificar a disponibilidade e confirmar o agendamento o mais rápido possível. 💬');
        
        userStates[user] = 'aguardando_dados_consulta';
        return; 
    }

    // Opção 2: VACINAS
    else if (msgBody === '2') {
        await sendTypingMessage(user, 'Manter a vacinação do seu pet em dia é essencial para garantir uma vida longa e saudável! ❤️\n\n*Confira abaixo as principais vacinas e valores:*\n\n🐶 CÃES\n🔹 Vacina Polivalente (Antiviral - Importada): R$ 60 a 70\nProtege contra Cinomose, Parvovirose, Coronavirose, Adenovirose, Parainfluenza e Hepatite Infecciosa Canina.\n🔹 Vacina Antirrábica (Raiva): R$ 30\nProtege contra a raiva — doença grave e obrigatória por lei.\n🔹 Vacina contra Gripe Canina (Tosse dos Canis): R$ 90\nRecomendada para cães que frequentam pet shops, creches, hotéis ou convivem com outros animais.\n\n🐱 GATOS\n🔹 Vacina Feline 1 (sem FELV): R$ 100\nProtege contra Rinotraqueíte, Calicivirose e Panleucopenia.\n🔹 Vacina Feline + FELV: R$ 150\nProtege contra as mesmas doenças da Feline 1 e também contra a Leucemia Felina (FELV).\n⚠️ Gatos que serão vacinados pela primeira vez para FELV devem fazer o teste antes da aplicação.');
        await sendTypingMessage(user, '🦠 Cuidados complementares importantes:\n✅ Carrapaticida: aplicar a cada 3 meses para prevenir doenças transmitidas por carrapatos.\n✅ Coleira contra Leishmaniose: essencial para cães, ajuda na proteção contra o mosquito transmissor.\n✅ Vermífugo: administrar regularmente conforme o peso e idade do pet.');
        
        await sendTypingMessage(user, 'Digite *1* se desejar *Agendar a vacinação* ou *Menu* para voltar.', 1500);
        return;
    }

    // Opção 3: EXAMES
    else if (msgBody === '3') {
        await sendTypingMessage(user, 'Na Vet Clin, priorizamos a qualidade do atendimento e o bem-estar individual de cada paciente.\nPor isso, realizamos exames apenas mediante consulta veterinária ou com encaminhamento/solicitação de outro profissional.\nDessa forma, garantimos que cada exame seja realmente necessário e interpretado de forma correta, assegurando um diagnóstico preciso e um tratamento adequado. 🐾💙');
        await sendTypingMessage(user, '🔍 Exames que realizamos:\n• Hemograma completo\n• Exames Bioquímicos (função hepática, renal, glicose, entre outros)\n• Radiografia\n• Ultrassonografia Abdominal\n• Endoscopia Veterinária\n• Teste de Leishmaniose (Calazar)\n• Teste de Cinomose\n• Teste de Parvovirose\n• Teste FIV/FELV (Leucemia e Imunodeficiência Felina)\n• E diversos outros exames laboratoriais especializados');

        await sendTypingMessage(user, 'Para realizar exames, é necessário agendar uma consulta ou enviar um pedido de exames por um medico veterinário \n\nDigite *1* se desejar *Agendar uma consulta* ou *Menu* para voltar.', 1500);
        return;
    }

    // Opção 4: LOCALIZAÇÃO E HORÁRIOS
    else if (msgBody === '4') {
        await sendTypingMessage(user, 'Estamos prontos para receber você e seu pet! 🐾');
        await client.sendMessage(user, '⏰ *Nosso horário de atendimento:*\nSegunda a Sexta: 8h às 18h\nSábado: 8h às 12h\n\n🚨 *Emergências: 24 horas*');
        await client.sendMessage(user, '*Nosso endereço:*\nAv. Joaquim Aires, 2301 - Centro, Porto Nacional - TO\n\n[https://share.google/KtFwbdJXQ8AVloaJD]');
        await sendTypingMessage(user, 'Digite *Menu* para voltar ao início.', 1000);
        return;
    }

    // Opção 5: FALAR COM ATENDENTE
    else if (msgBody === '5') {
        await sendTypingMessage(user, 'Ok! Estou transferindo sua conversa para um de nossos atendentes humanos. 👩‍⚕️');
        await sendTypingMessage(user, 'Por favor, aguarde um momento. Nosso horário de atendimento humano é de Seg a Sex (8h às 18h).\n\n*A partir de agora, um humano irá te responder.*');
        
        userStates[user] = 'aguardando_humano';
        return;
    }
    
    // Opção 6: EMERGÊNCIA
    else if (msgBody === '6') {
        await sendTypingMessage(user, '🚨 **EMERGÊNCIA** 🚨\n\nPor favor, **NÃO ESPERE** pela resposta aqui. Sua ligação será mais rápida.');
        
        await client.sendMessage(user, '📞 **LIGUE IMEDIATAMENTE**\n`(63) 99114-0858`');
        
        await client.sendMessage(user, '📍 *Após confirmaçção do atendimento venha neste endereço*\nAv. Joaquim Aires, 2301 - Centro, Porto Nacional - TO\n\n[https://share.google/KtFwbdJXQ8AVloaJD]');
        
        userStates[user] = 'aguardando_humano'; 
        return;
    }

    // =========================================================
    // BLOCO FINAL: MENSAGEM NÃO COMPREENDIDA (Última Opção)
    // =========================================================
    if (!state) { 
        await sendTypingMessage(user, 'Desculpe, não entendi o que você quis dizer. 🤔');
        await sendTypingMessage(user, 'Digite *Menu* para ver as opções disponíveis.', 1000);
        return; 
    }
});
