// Integração com a API Gemini (Interactions API) para leitura de editais.
import { GoogleGenAI } from '@google/genai';
import { db } from './db.js';
import { fetchPage, htmlToText, extractLinks } from './web.js';

export const DEFAULT_MODEL = 'gemini-3.8-flash';
// Documentos com mais de 512 KB (ex.: editais com dezenas de páginas) são enviados via Files API
// em vez de base64 inline para evitar payloads gigantes e quedas de conexão (fetch failed).
const INLINE_LIMIT = 512 * 1024;

// Desativa os timeouts padrão de 300s do Undici no Node.js local.
// Na Vercel não substituímos o dispatcher global para preservar a infraestrutura de rede serverless.
(function configureGlobalUndici() {
  if (process.env.VERCEL) return;
  try {
    const sym = Symbol.for('undici.globalDispatcher.1');
    if (!globalThis[sym] && typeof Request !== 'undefined') new Request('https://localhost');
    const current = globalThis[sym];
    if (current?.constructor?.name === 'Agent') {
      globalThis[sym] = new current.constructor({
        headersTimeout: 0,
        bodyTimeout: 0,
        connect: { timeout: 60_000 },
      });
    }
  } catch { /* fallback silencioso */ }
})();

export async function getAiConfig(userId = null) {
  const s = userId ? await db.getSettings(userId) : {};
  const apiKey = s.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  return { apiKey, model: s.geminiModel || process.env.GEMINI_MODEL || DEFAULT_MODEL, hasUserKey: Boolean(s.geminiApiKey) };
}

export async function aiAvailable(userId = null) {
  const cfg = await getAiConfig(userId);
  return Boolean(cfg.apiKey);
}

async function client(userId = null) {
  const { apiKey, model } = await getAiConfig(userId);
  if (!apiKey) {
    const err = new Error('Chave da API Gemini não configurada. Acesse Configurações para informá-la.');
    err.status = 400;
    throw err;
  }
  return { ai: new GoogleGenAI({ apiKey, apiVersion: 'v1beta' }), model };
}

// ---------------------------------------------------------------------------
// Esquema estruturado retornado pela IA
// ---------------------------------------------------------------------------
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });

const EDITAL_SCHEMA = {
  type: 'object',
  properties: {
    orgao: str('Nome completo do órgão/entidade que realiza o concurso.'),
    sigla: str('Sigla do órgão, se houver. Ex.: TRF1, PCDF. Vazio se não houver.'),
    banca: str('Banca organizadora (ex.: Cebraspe, FGV, FCC, Vunesp). Vazio se não informado.'),
    url: str('URL do site/página do concurso na banca, se houver. Vazio se não houver.'),
    editalUrl: str('URL direta do edital em PDF, se constar. Vazio se não houver.'),
    numeroEdital: str('Número/identificação do edital. Ex.: Edital nº 1/2026.'),
    cidades: { type: 'array', items: { type: 'string' }, description: 'Cidades onde as provas serão aplicadas.' },
    uf: str('UF principal (sigla de 2 letras) ou "Nacional".'),
    inscricaoInicio: str('Data de início das inscrições no formato AAAA-MM-DD. Vazio se não informado.'),
    inscricaoFim: str('Data de término das inscrições no formato AAAA-MM-DD. Vazio se não informado.'),
    taxaInscricao: str('Valor(es) da taxa de inscrição. Ex.: "R$ 85,00 (nível médio) / R$ 120,00 (nível superior)".'),
    dataProva: str('Data da prova objetiva no formato AAAA-MM-DD. Vazio se não informado.'),
    turnoProva: { type: 'string', enum: ['Manhã', 'Tarde', 'Noite', 'Manhã e Tarde', 'Integral', 'Não informado'] },
    horarioProva: str('Horário e duração da prova, se informado. Ex.: "8h às 12h30 (4h30)".'),
    cargos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nome: str('Nome do cargo (e especialidade/área, se houver).'),
          vagas: str('Quantidade de vagas. Ex.: "12 + CR", "Cadastro reserva".'),
          salario: num('Remuneração inicial em reais (número). 0 se não informado.'),
          escolaridade: str('Escolaridade exigida (Fundamental, Médio, Técnico, Superior).'),
          requisitos: str('Requisitos resumidos do cargo.'),
          jornada: str('Carga horária semanal. Ex.: "40h semanais".'),
        },
        required: ['nome', 'vagas', 'salario', 'escolaridade', 'requisitos', 'jornada'],
      },
    },
    beneficios: { type: 'array', items: { type: 'string' }, description: 'Benefícios e auxílios (com valores, quando informados).' },
    estruturaProva: {
      type: 'array',
      description: 'Etapas do certame (prova objetiva, discursiva, TAF, títulos, etc.).',
      items: {
        type: 'object',
        properties: {
          etapa: str('Nome da etapa. Ex.: "Prova objetiva".'),
          carater: str('Caráter: eliminatório, classificatório ou ambos.'),
          descricao: str('Detalhes: número de questões, pontuação, critérios de aprovação.'),
        },
        required: ['etapa', 'carater', 'descricao'],
      },
    },
    cronograma: {
      type: 'array',
      description: 'Principais eventos do cronograma com datas.',
      items: {
        type: 'object',
        properties: {
          evento: str('Descrição do evento.'),
          data: str('Data no formato AAAA-MM-DD (ou texto, se for período/indefinido).'),
        },
        required: ['evento', 'data'],
      },
    },
    provas: {
      type: 'array',
      description: 'Composição das provas objetivas por cargo/grupo de cargos: disciplinas, número de questões e pesos.',
      items: {
        type: 'object',
        properties: {
          nome: str('Nome da prova. Ex.: "Prova objetiva - Analista Judiciário".'),
          cargo: str('Cargo(s) a que se aplica.'),
          tipoQuestao: { type: 'string', enum: ['multipla', 'certo_errado'], description: 'multipla = múltipla escolha; certo_errado = itens certo/errado (estilo Cebraspe).' },
          numAlternativas: num('Número de alternativas por questão (4 ou 5). Use 2 para certo/errado.'),
          penalidade: { type: 'boolean', description: 'true se uma resposta errada anula uma certa.' },
          disciplinas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                nome: str('Nome da disciplina.'),
                qtdQuestoes: num('Número de questões/itens.'),
                peso: num('Peso/valor de cada questão. 1 se não informado.'),
                minimoAcertos: num('Mínimo de acertos exigido na disciplina/bloco. 0 se não houver.'),
              },
              required: ['nome', 'qtdQuestoes', 'peso', 'minimoAcertos'],
            },
          },
        },
        required: ['nome', 'cargo', 'tipoQuestao', 'numAlternativas', 'penalidade', 'disciplinas'],
      },
    },
    observacoes: str('Outras informações relevantes (isenção, cotas, validade, nota mínima, etc.).'),
    resumo: str('Resumo de 2 a 3 frases sobre o concurso.'),
  },
  required: [
    'orgao', 'sigla', 'banca', 'url', 'editalUrl', 'numeroEdital', 'cidades', 'uf', 'inscricaoInicio',
    'inscricaoFim', 'taxaInscricao', 'dataProva', 'turnoProva', 'horarioProva', 'cargos', 'beneficios',
    'estruturaProva', 'cronograma', 'provas', 'observacoes', 'resumo',
  ],
};

const SYSTEM = `Você é um especialista em concursos públicos brasileiros. Leia o edital (ou página) fornecido e extraia com precisão as informações solicitadas.
Regras:
- Responda SOMENTE com dados presentes no material; nunca invente. Quando algo não constar, use string vazia "", 0 ou lista vazia.
- Datas sempre no formato AAAA-MM-DD. Hoje é ${new Date().toISOString().slice(0, 10)}.
- Salários como número em reais (ex.: 13994.78). Se houver faixa, use a remuneração inicial.
- Liste TODOS os cargos e TODAS as disciplinas das provas objetivas, com quantidade de questões e pesos.
- Escreva em português do Brasil.`;

async function waitActive(ai, file) {
  let f = file;
  for (let i = 0; i < 20 && f.state && f.state !== 'ACTIVE'; i++) {
    if (f.state === 'FAILED') throw new Error('Falha ao processar o arquivo na API Gemini.');
    await new Promise((r) => setTimeout(r, 1000));
    f = await ai.files.get({ name: f.name });
  }
  return f;
}

function parseJsonResult(raw, fallbackMsg = 'A IA não retornou um JSON válido. Tente novamente.') {
  let data;
  try {
    data = JSON.parse(raw || '');
  } catch {
    const match = String(raw || '').match(/\{[\s\S]*\}/);
    if (!match) throw new Error(fallbackMsg);
    data = JSON.parse(match[0]);
  }
  return data;
}

function finalizeEditalData(interaction, { url = '', fontes = [], model = DEFAULT_MODEL } = {}) {
  const data = parseJsonResult(interaction.output_text);
  if (!data.url && url && fontes.includes('pagina')) data.url = url;
  if (!data.editalUrl && url && fontes.includes('pdf-url')) data.editalUrl = url;
  return { status: 'completed', data, fontes, model: interaction.model || model };
}

async function documentPart(ai, buffer, mimeType) {
  if (buffer.length <= INLINE_LIMIT) {
    return { type: 'document', data: buffer.toString('base64'), mime_type: mimeType };
  }
  try {
    const uploaded = await waitActive(ai, await ai.files.upload({
      file: new Blob([buffer], { type: mimeType }),
      config: { mimeType },
    }));
    return { type: 'document', uri: uploaded.uri, mime_type: uploaded.mimeType || mimeType };
  } catch (err) {
    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error(`Falha ao enviar o PDF para a API Gemini (${err.message}).`);
    }
    console.warn('[ai] Upload via Files API falhou, usando envio inline:', err.message);
    return { type: 'document', data: buffer.toString('base64'), mime_type: mimeType };
  }
}

/**
 * Inicia a extração do edital (em background quando suportado, evitando timeouts serverless).
 * @param {{ fileBuffer?: Buffer, fileBase64?: string, mimeType?: string, text?: string, url?: string }} input
 */
export async function extractEdital(input, userId = null) {
  const { ai, model } = await client(userId);
  const parts = [];
  const fontes = [];

  if (input.fileBuffer || input.fileBase64) {
    const buffer = input.fileBuffer || Buffer.from(input.fileBase64, 'base64');
    const mime = input.mimeType || 'application/pdf';
    if (mime === 'application/pdf') parts.push(await documentPart(ai, buffer, mime));
    else parts.push({ type: 'text', text: `Conteúdo do arquivo enviado:\n${buffer.toString('utf8').slice(0, 400_000)}` });
    fontes.push('arquivo');
  }

  if (input.url) {
    const page = await fetchPage(input.url, { maxBytes: 40 * 1024 * 1024 });
    if (page.isPdf) {
      parts.push(await documentPart(ai, page.buffer, 'application/pdf'));
      fontes.push('pdf-url');
    } else {
      const text = htmlToText(page.body);
      parts.push({ type: 'text', text: `Página do concurso (${input.url}):\n${text.slice(0, 200_000)}` });
      fontes.push('pagina');
      if (!input.fileBuffer && !input.fileBase64) {
        const links = extractLinks(page.body, page.finalUrl);
        const edital = links.find((l) => /\.pdf(\?|$)/i.test(l.href) && /edital|abertura/i.test(`${l.text} ${l.href}`) && !/retifica/i.test(`${l.text} ${l.href}`))
          || links.find((l) => /\.pdf(\?|$)/i.test(l.href) && /edital/i.test(`${l.text} ${l.href}`));
        if (edital) {
          try {
            const pdf = await fetchPage(edital.href, { maxBytes: 40 * 1024 * 1024 });
            if (pdf.isPdf) {
              parts.push(await documentPart(ai, pdf.buffer, 'application/pdf'));
              fontes.push(`edital-linkado:${edital.href}`);
            }
          } catch { /* segue apenas com a página */ }
        }
      }
    }
  }

  if (input.text?.trim()) {
    parts.push({ type: 'text', text: `Texto do edital informado pelo usuário:\n${input.text.slice(0, 400_000)}` });
    fontes.push('texto');
  }

  if (!parts.length) {
    const err = new Error('Envie o PDF do edital, uma URL ou cole o texto.');
    err.status = 400;
    throw err;
  }

  parts.push({ type: 'text', text: `Extraia as informações do concurso conforme o esquema.${input.url ? ` URL informada pelo usuário: ${input.url}` : ''}` });

  const baseReq = {
    model,
    system_instruction: SYSTEM,
    input: [{ type: 'user_input', content: parts }],
    generation_config: { thinking_level: 'low' },
    response_format: { type: 'text', mime_type: 'application/json', schema: EDITAL_SCHEMA },
  };

  let interaction;
  try {
    // Executa em segundo plano na API Gemini para responder imediatamente e evitar timeout em serverless
    interaction = await ai.interactions.create(
      { ...baseReq, background: true, store: true },
      { timeout_ms: 45_000, maxRetries: 1 },
    );
  } catch (err) {
    // Fallback síncrono caso o modelo/conta não suporte background: true
    if (err.status === 400 && /background|store/i.test(err.message || '')) {
      interaction = await ai.interactions.create(
        { ...baseReq, store: false },
        { timeout_ms: 240_000, maxRetries: 1 },
      );
      return finalizeEditalData(interaction, { url: input.url, fontes, model });
    }
    throw err;
  }

  if (interaction.status === 'completed') {
    return finalizeEditalData(interaction, { url: input.url, fontes, model });
  }
  if (interaction.status === 'failed' || interaction.status === 'cancelled') {
    throw new Error(interaction.error?.message || 'A IA não conseguiu concluir a leitura do edital.');
  }

  return {
    status: interaction.status || 'in_progress',
    jobId: interaction.id,
    fontes,
    model,
    url: input.url || '',
  };
}

export async function getEditalJobStatus(jobId, { url = '', fontes = [], userId = null } = {}) {
  const { ai, model } = await client(userId);
  const interaction = await ai.interactions.get(jobId, {}, { timeout_ms: 20_000, maxRetries: 1 });

  if (interaction.status === 'completed') {
    return finalizeEditalData(interaction, { url, fontes, model });
  }
  if (interaction.status === 'failed' || interaction.status === 'cancelled') {
    const err = new Error(interaction.error?.message || 'Falha ao processar o edital na IA. Tente novamente.');
    err.status = 502;
    throw err;
  }
  return { status: interaction.status || 'in_progress', jobId };
}

/** Gera um resumo curto (em linguagem natural) das alterações detectadas na página. */
export async function summarizeChange({ orgao, added, removed, newLinks, userId = null }) {
  if (!(await aiAvailable(userId))) return '';
  try {
    const { ai, model } = await client(userId);
    const interaction = await ai.interactions.create({
      model,
      system_instruction: 'Você ajuda concurseiros a acompanhar páginas de concursos públicos. Responda em português, em no máximo 2 frases objetivas, destacando o que importa ao candidato (novos editais, retificações, prorrogações, resultados, locais de prova). Ignore mudanças irrelevantes de layout.',
      input: `Concurso: ${orgao}\n\nNovos links/documentos:\n${newLinks.map((l) => `- ${l.text} (${l.href})`).join('\n') || '(nenhum)'}\n\nTrechos adicionados:\n${added.join('\n').slice(0, 6000) || '(nenhum)'}\n\nTrechos removidos:\n${removed.join('\n').slice(0, 3000) || '(nenhum)'}\n\nResuma o que mudou.`,
      store: false,
    });
    return (interaction.output_text || '').trim();
  } catch (err) {
    console.warn('[ai] Falha ao resumir alteração:', err.message);
    return '';
  }
}

export async function testAi(userId = null) {
  const { ai, model } = await client(userId);
  const r = await ai.interactions.create({ model, input: 'Responda apenas: OK', store: false });
  return { ok: true, model, reply: (r.output_text || '').trim() };
}

const GABARITO_SCHEMA = {
  type: 'object',
  properties: {
    respostas: {
      type: 'array',
      description: 'Lista ordenada das respostas extraídas do arquivo (por número da questão).',
      items: {
        type: 'object',
        properties: {
          questao: num('Número da questão/item (1, 2, 3, ...).'),
          resposta: str('Alternativa ou marcação da questão em letra maiúscula (ex.: A, B, C, D, E para múltipla escolha; C ou E para certo/errado; X se anulada; vazio "" se em branco).'),
        },
        required: ['questao', 'resposta'],
      },
    },
    observacao: str('Breve observação caso haja mais de um caderno/cargo no arquivo e qual foi selecionado, ou string vazia.'),
  },
  required: ['respostas', 'observacao'],
};

async function imagePart(ai, buffer, mimeType) {
  if (buffer.length <= INLINE_LIMIT) {
    return { type: 'image', data: buffer.toString('base64'), mime_type: mimeType };
  }
  try {
    const uploaded = await waitActive(ai, await ai.files.upload({
      file: new Blob([buffer], { type: mimeType }),
      config: { mimeType },
    }));
    return { type: 'image', uri: uploaded.uri, mime_type: uploaded.mimeType || mimeType };
  } catch (err) {
    console.warn('[ai] Upload de imagem via Files API falhou, usando envio inline:', err.message);
    return { type: 'image', data: buffer.toString('base64'), mime_type: mimeType };
  }
}

function finalizeGabaritoData(interaction, { total, opcoesValidas, permiteX, isCE, model }) {
  const parsed = parseJsonResult(interaction.output_text, 'A IA não conseguiu extrair o gabarito do arquivo enviado.');
  const validSet = new Set([...opcoesValidas, ...(permiteX ? ['X'] : [])]);
  const out = Array(total).fill('');
  let lidas = 0;

  for (const item of parsed.respostas || []) {
    const q = Number(item?.questao);
    if (!Number.isInteger(q) || q < 1 || q > total) continue;
    let r = String(item?.resposta || '').trim().toUpperCase();
    if (r === '*' || r === '#' || /^ANUL|^NULA/.test(r)) r = 'X';
    if (isCE && r === 'CERTO') r = 'C';
    if (isCE && r === 'ERRADO') r = 'E';
    if (validSet.has(r)) {
      if (!out[q - 1]) lidas++;
      out[q - 1] = r;
    }
  }

  return {
    status: 'completed',
    respostas: out,
    lidas,
    observacao: (parsed.observacao || '').trim(),
    model: interaction.model || model,
  };
}

/**
 * Extrai respostas de um gabarito oficial ou cartão-resposta do usuário (PDF, TXT ou imagem).
 * @param {{ fileBuffer?: Buffer, fileBase64?: string, mimeType?: string, fileName?: string, modo?: 'oficial'|'usuario', tipoQuestao?: 'multipla'|'certo_errado', numAlternativas?: number, totalQuestoes?: number, cargo?: string, nomeProva?: string }} input
 */
export async function extractGabarito(input, userId = null) {
  if (!input?.fileBuffer && !input?.fileBase64) {
    const err = new Error('Envie um arquivo PDF, TXT ou imagem (JPG/PNG) do gabarito.');
    err.status = 400;
    throw err;
  }

  const { ai, model } = await client(userId);
  const buffer = input.fileBuffer || Buffer.from(input.fileBase64, 'base64');
  const rawMime = (input.mimeType || '').toLowerCase();
  const ext = (input.fileName || '').toLowerCase().split('.').pop();

  let mime = rawMime;
  if (!mime || mime === 'application/octet-stream') {
    if (ext === 'pdf') mime = 'application/pdf';
    else if (ext === 'png') mime = 'image/png';
    else if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
    else if (ext === 'txt') mime = 'text/plain';
  }
  if (mime === 'image/jpg') mime = 'image/jpeg';

  const parts = [];
  if (mime === 'application/pdf') {
    parts.push(await documentPart(ai, buffer, 'application/pdf'));
  } else if (mime === 'image/jpeg' || mime === 'image/png' || mime.startsWith('image/')) {
    parts.push(await imagePart(ai, buffer, mime.startsWith('image/') ? mime : 'image/jpeg'));
  } else if (mime === 'text/plain' || ext === 'txt') {
    parts.push({ type: 'text', text: `Conteúdo do arquivo de gabarito:\n${buffer.toString('utf8').slice(0, 400_000)}` });
  } else {
    const err = new Error('Formato não suportado. Envie um arquivo PDF, TXT, JPG, JPEG ou PNG.');
    err.status = 400;
    throw err;
  }

  const total = Math.max(1, Number(input.totalQuestoes) || 100);
  const isCE = input.tipoQuestao === 'certo_errado';
  const numAlt = Math.min(Math.max(Number(input.numAlternativas) || 5, 2), 6);
  const opcoesValidas = isCE ? ['C', 'E'] : 'ABCDEF'.slice(0, numAlt).split('');
  const permiteX = input.modo !== 'usuario';

  const contexto = [
    `Tipo de gabarito: ${input.modo === 'usuario' ? 'Respostas do candidato (cartão-resposta / folha de respostas / anotações)' : 'Gabarito oficial da banca'}.`,
    `Modalidade das questões: ${isCE ? 'Certo ou Errado (use "C" para Certo e "E" para Errado)' : `Múltipla escolha com alternativas ${opcoesValidas.join(', ')}`}.`,
    permiteX
      ? 'Questões anuladas (marcadas como X, *, #, ANULADA ou NULA) devem ter resposta "X".'
      : 'Se uma questão estiver em branco, rasurada ou sem marcação, retorne "" (vazio).',
    `Total esperado de questões na prova: ${total} (questões de 1 a ${total}).`,
    input.cargo ? `Cargo de referência: ${input.cargo}.` : '',
    input.nomeProva ? `Nome da prova: ${input.nomeProva}.` : '',
  ].filter(Boolean).join('\n');

  parts.push({
    type: 'text',
    text: `Extraia todas as respostas do gabarito presente no arquivo.\n\nContexto da prova:\n${contexto}\n\nInstruções:\n- Identifique cada número de questão (1 até ${total}) e sua respectiva resposta.\n- Caso o documento contenha gabaritos de vários cargos ou tipos de prova, priorize o cargo/prova informado no contexto (ou o primeiro gabarito compatível com ${total} questões).\n- Padronize cada resposta como uma única letra maiúscula dentre [${[...opcoesValidas, ...(permiteX ? ['X'] : [])].join(', ')}] ou "" se em branco.`,
  });

  const baseReq = {
    model,
    system_instruction: 'Você é um leitor óptico e extrator especialista em gabaritos e cartões-resposta de concursos públicos brasileiros. Extraia com exatidão o número de cada questão e a alternativa marcada.',
    input: [{ type: 'user_input', content: parts }],
    generation_config: { thinking_level: 'low' },
    response_format: { type: 'text', mime_type: 'application/json', schema: GABARITO_SCHEMA },
  };

  const meta = { total, opcoesValidas, permiteX, isCE, model };
  let interaction;
  try {
    interaction = await ai.interactions.create(
      { ...baseReq, background: true, store: true },
      { timeout_ms: 45_000, maxRetries: 1 },
    );
  } catch (err) {
    if (err.status === 400 && /background|store/i.test(err.message || '')) {
      interaction = await ai.interactions.create(
        { ...baseReq, store: false },
        { timeout_ms: 180_000, maxRetries: 1 },
      );
      return finalizeGabaritoData(interaction, meta);
    }
    throw err;
  }

  if (interaction.status === 'completed') {
    return finalizeGabaritoData(interaction, meta);
  }
  if (interaction.status === 'failed' || interaction.status === 'cancelled') {
    throw new Error(interaction.error?.message || 'A IA não conseguiu extrair o gabarito do arquivo enviado.');
  }
  return {
    status: interaction.status || 'in_progress',
    jobId: interaction.id,
    model,
  };
}

export async function getGabaritoJobStatus(jobId, opts, userId = null) {
  const { ai, model } = await client(userId);
  const interaction = await ai.interactions.get(jobId, {}, { timeout_ms: 20_000, maxRetries: 1 });
  const total = Math.max(1, Number(opts?.totalQuestoes) || 100);
  const isCE = opts?.tipoQuestao === 'certo_errado';
  const numAlt = Math.min(Math.max(Number(opts?.numAlternativas) || 5, 2), 6);
  const opcoesValidas = isCE ? ['C', 'E'] : 'ABCDEF'.slice(0, numAlt).split('');
  const permiteX = opts?.modo !== 'usuario';

  if (interaction.status === 'completed') {
    return finalizeGabaritoData(interaction, { total, opcoesValidas, permiteX, isCE, model });
  }
  if (interaction.status === 'failed' || interaction.status === 'cancelled') {
    const err = new Error(interaction.error?.message || 'A IA não conseguiu extrair o gabarito do arquivo enviado.');
    err.status = 502;
    throw err;
  }
  return { status: interaction.status || 'in_progress', jobId };
}
