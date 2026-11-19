// Integração com a API do Telegram Bot para disparo de notificações do monitoramento
// vinculadas ao cadastro e ao número de telefone do usuário.

const TG_API = 'https://api.telegram.org';

/**
 * Normaliza e valida um telefone para o padrão internacional E.164 (ex.: +5511999999999),
 * compatível com contatos da API do Telegram.
 */
export function normalizePhone(raw = '') {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) {
    const err = new Error('Informe um número de telefone válido com DDD (ex.: +55 11 99999-9999).');
    err.status = 400;
    throw err;
  }
  let full = digits;
  const hasPlus = trimmed.startsWith('+');
  // Se o usuário informou apenas DDD + número (10 ou 11 dígitos no Brasil, sem '+' explícito), prefixa +55 automaticamente.
  if (!hasPlus && (digits.length === 10 || digits.length === 11)) {
    full = `55${digits}`;
  }
  if (full.length < 11 || full.length > 15) {
    const err = new Error('Número de telefone inválido. Use o formato com DDI e DDD (ex.: +55 11 99999-9999).');
    err.status = 400;
    throw err;
  }
  return `+${full}`;
}

/**
 * Compara dois números de telefone considerando também a variação do 9º dígito no Brasil
 * (o Telegram frequentemente armazena contas brasileiras com 12 ou 13 dígitos).
 */
export function phoneDigitsMatch(a = '', b = '') {
  const da = String(a || '').replace(/\D/g, '');
  const db = String(b || '').replace(/\D/g, '');
  if (!da || !db || da.length < 10 || db.length < 10) return false;
  if (da === db) return true;
  // Compara código de área (DDD) + últimos 8 dígitos para números brasileiros
  const normBr = (d) => {
    const withoutCountry = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
    if (withoutCountry.length === 11 && withoutCountry[2] === '9') {
      return `${withoutCountry.slice(0, 2)}${withoutCountry.slice(3)}`;
    }
    return withoutCountry;
  };
  return normBr(da) === normBr(db);
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function tgCall(botToken, method, body = undefined, timeoutMs = 12_000) {
  const url = `${TG_API}/bot${botToken}/${method}`;
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    signal: AbortSignal.timeout(timeoutMs),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok || !json?.ok) {
    const desc = json?.description || text || `HTTP ${res.status}`;
    const err = new Error(
      res.status === 401 || /Unauthorized/i.test(desc)
        ? 'Token do Bot do Telegram inválido. Verifique o token gerado no @BotFather.'
        : `Telegram API: ${desc}`,
    );
    err.status = res.status === 401 ? 400 : 502;
    throw err;
  }
  return json.result;
}

export function getTelegramLinkCode(userId) {
  return `jc_${String(userId || '').slice(0, 8)}`;
}

export async function getTelegramStatus(db, userId) {
  const user = await db.getUserById(userId);
  const s = user?.settings || {};
  const userToken = String(s.telegramBotToken || '').trim();
  const envToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const botToken = userToken || envToken;
  const chatId = String(s.telegramChatId || '').trim();
  const botUsername = String(s.telegramBotUsername || '').trim();
  const linkCode = getTelegramLinkCode(userId);

  return {
    ativo: s.telegramAtivo !== false,
    botConfigurado: Boolean(botToken),
    tokenOrigem: userToken ? 'app' : envToken ? 'env' : null,
    tokenMascarado: botToken ? `${botToken.slice(0, 6)}…${botToken.slice(-4)}` : '',
    botUsername,
    chatId,
    chatName: s.telegramChatName || '',
    vinculado: Boolean(botToken && chatId),
    telefone: user?.telefone || '',
    linkCode,
    botDeepLink: botUsername ? `https://t.me/${botUsername}?start=${linkCode}` : '',
  };
}

/**
 * Consulta o Bot no Telegram (getMe + getUpdates) para descobrir o username do bot
 * e vincular automaticamente o Chat ID ao número de telefone ou código do usuário.
 */
export async function syncTelegramChat(db, userId) {
  const user = await db.getUserById(userId);
  if (!user) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });

  const s = user.settings || {};
  const botToken = String(s.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!botToken) {
    throw Object.assign(new Error('Configure primeiro o Token do Bot do Telegram.'), { status: 400 });
  }

  const me = await tgCall(botToken, 'getMe');
  const botUsername = me?.username || '';
  const linkCode = getTelegramLinkCode(userId);
  const userPhone = user.telefone || '';

  const updates = await tgCall(botToken, 'getUpdates?limit=100');
  let matchedChat = null;

  // Percorre das mensagens mais recentes para as mais antigas
  for (let i = (updates || []).length - 1; i >= 0; i--) {
    const u = updates[i];
    const msg = u.message || u.edited_message;
    const chat = msg?.chat;
    if (!chat || chat.type !== 'private') continue;
    const txt = String(msg.text || '').trim();

    // 1. Vínculo exato via deep-link (/start jc_xxxxxxxx)
    if (txt.includes(linkCode)) {
      matchedChat = chat;
      break;
    }

    // 2. Vínculo pelo número de telefone cadastrado (contato compartilhado ou texto enviado ao bot)
    if (userPhone) {
      const contactPhone = msg.contact?.phone_number || '';
      if (contactPhone && phoneDigitsMatch(contactPhone, userPhone)) {
        matchedChat = chat;
        break;
      }
      const digitsInText = txt.replace(/\D/g, '');
      if (digitsInText.length >= 10 && phoneDigitsMatch(digitsInText, userPhone)) {
        matchedChat = chat;
        break;
      }
    }
  }

  // 3. Se o usuário configurou um bot próprio (token na conta) e enviou /start ao bot, vincula a conversa privada
  if (!matchedChat && s.telegramBotToken) {
    for (let i = (updates || []).length - 1; i >= 0; i--) {
      const msg = updates[i]?.message;
      if (msg?.chat?.type === 'private') {
        matchedChat = msg.chat;
        break;
      }
    }
  }

  const patch = { telegramBotUsername: botUsername };
  if (matchedChat) {
    patch.telegramChatId = String(matchedChat.id);
    patch.telegramChatName = [matchedChat.first_name, matchedChat.last_name].filter(Boolean).join(' ')
      || matchedChat.username
      || '';
  }

  await db.updateSettings(userId, patch);
  return getTelegramStatus(db, userId);
}

/**
 * Envia uma mensagem de teste para o Telegram do usuário.
 */
export async function sendTelegramTest(db, userId) {
  let status = await getTelegramStatus(db, userId);
  if (!status.botConfigurado) {
    throw Object.assign(new Error('Informe e salve o Token do Bot do Telegram antes de testar.'), { status: 400 });
  }
  if (!status.chatId) {
    status = await syncTelegramChat(db, userId);
  }
  if (!status.chatId) {
    const hint = status.botDeepLink
      ? `Abra o link ${status.botDeepLink} no Telegram, clique em "Começar" (ou envie seu telefone ${status.telefone || ''} para o bot) e tente novamente.`
      : 'Abra seu bot no Telegram, envie /start (ou seu número de telefone cadastrado) e clique em "Vincular / Testar".';
    throw Object.assign(new Error(`Conversa com o bot ainda não localizada. ${hint}`), { status: 400 });
  }

  const user = await db.getUserById(userId);
  const s = user?.settings || {};
  const botToken = String(s.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();

  const phoneLine = user?.telefone ? `\n📱 Telefone vinculado: <b>${escapeHtml(user.telefone)}</b>` : '';
  const text = [
    '🎯 <b>Jornada do Concurseiro — Telegram Conectado!</b>',
    `Olá, <b>${escapeHtml(user?.nome || 'Concurseiro(a)')}</b>!${phoneLine}`,
    '',
    'A partir de agora você receberá por aqui todos os alertas do monitoramento de páginas (novos editais, retificações, convocações e prazos).',
  ].join('\n');

  await tgCall(botToken, 'sendMessage', {
    chat_id: status.chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  return { ok: true, status };
}

/**
 * Dispara automaticamente uma notificação do monitoramento para o Telegram do usuário.
 * Chamado sempre que `db.addNotificacao(userId, n)` registra uma novidade.
 */
export async function notifyUserTelegram(db, userId, notificacao) {
  try {
    let status = await getTelegramStatus(db, userId);
    if (!status.ativo || !status.botConfigurado) return { sent: false };
    if (!status.chatId && status.telefone) {
      status = await syncTelegramChat(db, userId).catch(() => status);
    }
    if (!status.chatId) return { sent: false };

    const user = await db.getUserById(userId);
    const s = user?.settings || {};
    const botToken = String(s.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!botToken) return { sent: false };

    const icon = notificacao.tipo === 'alteracao' ? '🔔' : notificacao.tipo === 'lembrete' ? '⏰' : '⚠️';
    const lines = [
      `${icon} <b>${escapeHtml(notificacao.titulo || 'Notificação')}</b>`,
      escapeHtml(notificacao.mensagem || ''),
    ];

    if (notificacao.detalhes?.novosLinks?.length) {
      lines.push('', '📄 <b>Novos documentos/links:</b>');
      for (const l of notificacao.detalhes.novosLinks.slice(0, 5)) {
        lines.push(`• <a href="${escapeHtml(l.href)}">${escapeHtml(l.text || l.href)}</a>`);
      }
    }

    if (user?.telefone) {
      lines.push('', `<i>Destinatário: ${escapeHtml(user.telefone)}</i>`);
    }

    await tgCall(botToken, 'sendMessage', {
      chat_id: status.chatId,
      text: lines.join('\n'),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    return { sent: true };
  } catch (err) {
    console.warn('[telegram] Falha ao enviar notificação:', err.message);
    return { sent: false, error: err.message };
  }
}
