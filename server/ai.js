// Integração multi-provedor de IA (Google Gemini, OpenAI ChatGPT e Anthropic Claude)
// para leitura de editais, extração de gabaritos e resumo de alterações no monitoramento.
import { GoogleGenAI } from '@google/genai';
import { db } from './db.js';
import { fetchPage, htmlToText, extractLinks } from './web.js';

export const DEFAULT_MODEL = 'gemini-3.8-flash';
const INLINE_LIMIT = 512 * 1024;

export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    defaultModel: 'gemini-3.8-flash',
    suggestedModels: ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-4-carbon', 'gemini-3.5-flash-lite'],
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    modelEnv: 'GEMINI_MODEL',
    settingsKey: 'geminiApiKey',
    settingsModel: 'geminiModel',
    docsUrl: 'https://aistudio.google.com/apikey',
    docsLabel: 'aistudio.google.com/apikey',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    shortLabel: 'ChatGPT',
    defaultModel: 'gpt-6.2-sol',
    suggestedModels: ['gpt-6.2-sol', 'gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.2-astra', 'gpt-5.4', 'gpt-4o'],
    envKeys: ['OPENAI_API_KEY'],
    modelEnv: 'OPENAI_MODEL',
    settingsKey: 'openaiApiKey',
    settingsModel: 'openaiModel',
    docsUrl: 'https://platform.openai.com/api-keys',
    docsLabel: 'platform.openai.com/api-keys',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    shortLabel: 'Claude',
    defaultModel: 'claude-sonnet-5-5',
    suggestedModels: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-4-5'],
    envKeys: ['ANTHROPIC_API_KEY'],
    modelEnv: 'ANTHROPIC_MODEL',
    settingsKey: 'anthropicApiKey',
    settingsModel: 'anthropicModel',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    docsLabel: 'console.anthropic.com/settings/keys',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

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

// ---------------------------------------------------------------------------
// Resolução de configuração multi-provedor
// ---------------------------------------------------------------------------
function resolveProviderEntry(s, id) {
  const meta = PROVIDERS[id];
  const userKey = String(s?.[meta.settingsKey] || '').trim();
  const envKey = meta.envKeys.map((k) => String(process.env[k] || '').trim()).find(Boolean) || '';
  const apiKey = userKey || envKey;
  const model = String(s?.[meta.settingsModel] || process.env[meta.modelEnv] || meta.defaultModel).trim() || meta.defaultModel;
  return {
    id,
    label: meta.label,
    shortLabel: meta.shortLabel,
    apiKey,
    model,
    defaultModel: meta.defaultModel,
    suggestedModels: meta.suggestedModels,
    hasUserKey: Boolean(userKey),
    source: userKey ? 'app' : envKey ? 'env' : null,
    docsUrl: meta.docsUrl,
    docsLabel: meta.docsLabel,
  };
}

export async function getAllProvidersConfig(userId = null) {
  const s = userId ? await db.getSettings(userId) : {};
  const providers = {};
  for (const id of PROVIDER_IDS) providers[id] = resolveProviderEntry(s, id);

  let active = PROVIDERS[s?.aiProvider] ? s.aiProvider : null;
  if (!active || !providers[active].apiKey) {
    const firstConfigured = PROVIDER_IDS.find((id) => Boolean(providers[id].apiKey));
    active = firstConfigured || active || 'gemini';
  }
  return { active, providers };
}

export async function getAiConfig(userId = null, providerOverride = null) {
  const { active, providers } = await getAllProvidersConfig(userId);
  const chosen = providerOverride && PROVIDERS[providerOverride] ? providerOverride : active;
  const entry = providers[chosen];
  return {
    provider: chosen,
    providerLabel: entry.label,
    providerShortLabel: entry.shortLabel,
    apiKey: entry.apiKey,
    model: entry.model,
    hasUserKey: entry.hasUserKey,
    source: entry.source,
  };
}

export async function aiAvailable(userId = null, providerOverride = null) {
  const cfg = await getAiConfig(userId, providerOverride);
  return Boolean(cfg.apiKey);
}

async function requireProviderConfig(userId = null, providerOverride = null) {
  const cfg = await getAiConfig(userId, providerOverride);
  if (!cfg.apiKey) {
    const err = new Error(`Chave da API ${cfg.providerLabel} não configurada. Acesse Configurações para informá-la.`);
    err.status = 400;
    throw err;
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Esquemas estruturados
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

const SYSTEM_EDITAL = `Você é um especialista em concursos públicos brasileiros. Leia o edital (ou página) fornecido e extraia com precisão as informações solicitadas.
Regras:
- Responda SOMENTE com dados presentes no material; nunca invente. Quando algo não constar, use string vazia "", 0 ou lista vazia.
- Datas sempre no formato AAAA-MM-DD. Hoje é ${new Date().toISOString().slice(0, 10)}.
- Salários como número em reais (ex.: 13994.78). Se houver faixa, use a remuneração inicial.
- Liste TODOS os cargos e TODAS as disciplinas das provas objetivas, com quantidade de questões e pesos.
- Escreva em português do Brasil.`;

const SYSTEM_GABARITO = 'Você é um leitor óptico e extrator especialista em gabaritos e cartões-resposta de concursos públicos brasileiros. Extraia com exatidão o número de cada questão e a alternativa marcada.';

const SYSTEM_MONITOR = 'Você ajuda concurseiros a acompanhar páginas de concursos públicos. Responda em português, em no máximo 2 frases objetivas, destacando o que importa ao candidato (novos editais, retificações, prorrogações, resultados, locais de prova). Ignore mudanças irrelevantes de layout.';

/** Adiciona additionalProperties: false recursivamente (exigido por OpenAI strict JSON schema e Anthropic). */
function makeStrictSchema(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(makeStrictSchema);
  const copy = { ...node };
  if (copy.type === 'object' && copy.properties) {
    copy.additionalProperties = false;
    copy.properties = Object.fromEntries(
      Object.entries(copy.properties).map(([k, v]) => [k, makeStrictSchema(v)]),
    );
    if (!copy.required) copy.required = Object.keys(copy.properties);
  }
  if (copy.items) copy.items = makeStrictSchema(copy.items);
  return copy;
}

function parseJsonResult(raw, fallbackMsg = 'A IA não retornou um JSON válido. Tente novamente.') {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw || ''));
  } catch {
    const match = String(raw || '').match(/\{[\s\S]*\}/);
    if (!match) throw new Error(fallbackMsg);
    return JSON.parse(match[0]);
  }
}

function parseJobId(jobId) {
  const s = String(jobId || '');
  const idx = s.indexOf(':');
  if (idx > 0) {
    const prefix = s.slice(0, idx);
    if (PROVIDERS[prefix]) return { provider: prefix, rawId: s.slice(idx + 1) };
  }
  return { provider: 'gemini', rawId: s };
}

// ---------------------------------------------------------------------------
// Adaptador 1: Google Gemini (@google/genai Interactions API)
// ---------------------------------------------------------------------------
async function waitGeminiFileActive(ai, file) {
  let f = file;
  for (let i = 0; i < 20 && f.state && f.state !== 'ACTIVE'; i++) {
    if (f.state === 'FAILED') throw new Error('Falha ao processar o arquivo na API Gemini.');
    await new Promise((r) => setTimeout(r, 1000));
    f = await ai.files.get({ name: f.name });
  }
  return f;
}

async function toGeminiParts(ai, items) {
  const parts = [];
  for (const item of items) {
    if (item.kind === 'text') {
      parts.push({ type: 'text', text: item.text });
    } else if (item.kind === 'pdf') {
      if (item.buffer.length <= INLINE_LIMIT) {
        parts.push({ type: 'document', data: item.buffer.toString('base64'), mime_type: 'application/pdf' });
      } else {
        try {
          const uploaded = await waitGeminiFileActive(ai, await ai.files.upload({
            file: new Blob([item.buffer], { type: 'application/pdf' }),
            config: { mimeType: 'application/pdf' },
          }));
          parts.push({ type: 'document', uri: uploaded.uri, mime_type: uploaded.mimeType || 'application/pdf' });
        } catch (err) {
          if (item.buffer.length > 10 * 1024 * 1024) {
            throw new Error(`Falha ao enviar o PDF para a API Gemini (${err.message}).`);
          }
          parts.push({ type: 'document', data: item.buffer.toString('base64'), mime_type: 'application/pdf' });
        }
      }
    } else if (item.kind === 'image') {
      const mime = item.mimeType || 'image/jpeg';
      if (item.buffer.length <= INLINE_LIMIT) {
        parts.push({ type: 'image', data: item.buffer.toString('base64'), mime_type: mime });
      } else {
        try {
          const uploaded = await waitGeminiFileActive(ai, await ai.files.upload({
            file: new Blob([item.buffer], { type: mime }),
            config: { mimeType: mime },
          }));
          parts.push({ type: 'image', uri: uploaded.uri, mime_type: uploaded.mimeType || mime });
        } catch {
          parts.push({ type: 'image', data: item.buffer.toString('base64'), mime_type: mime });
        }
      }
    }
  }
  return parts;
}

async function runGeminiStructured(cfg, { system, items, schema }) {
  const ai = new GoogleGenAI({ apiKey: cfg.apiKey, apiVersion: 'v1beta' });
  const parts = await toGeminiParts(ai, items);
  const baseReq = {
    model: cfg.model,
    system_instruction: system,
    input: [{ type: 'user_input', content: parts }],
    generation_config: { thinking_level: 'low' },
    response_format: { type: 'text', mime_type: 'application/json', schema },
  };

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
        { timeout_ms: 240_000, maxRetries: 1 },
      );
      return { status: 'completed', output: interaction.output_text || '', model: interaction.model || cfg.model };
    }
    throw err;
  }

  if (interaction.status === 'completed') {
    return { status: 'completed', output: interaction.output_text || '', model: interaction.model || cfg.model };
  }
  if (interaction.status === 'failed' || interaction.status === 'cancelled') {
    throw new Error(interaction.error?.message || 'A API Gemini não conseguiu concluir o processamento.');
  }
  return { status: interaction.status || 'in_progress', jobId: `gemini:${interaction.id}`, model: cfg.model };
}

async function pollGeminiStructured(cfg, rawId) {
  const ai = new GoogleGenAI({ apiKey: cfg.apiKey, apiVersion: 'v1beta' });
  const interaction = await ai.interactions.get(rawId, {}, { timeout_ms: 20_000, maxRetries: 1 });
  if (interaction.status === 'completed') {
    return { status: 'completed', output: interaction.output_text || '', model: interaction.model || cfg.model };
  }
  if (interaction.status === 'failed' || interaction.status === 'cancelled') {
    const err = new Error(interaction.error?.message || 'Falha ao processar na API Gemini.');
    err.status = 502;
    throw err;
  }
  return { status: interaction.status || 'in_progress', jobId: `gemini:${rawId}` };
}

async function runGeminiText(cfg, { system, prompt }) {
  const ai = new GoogleGenAI({ apiKey: cfg.apiKey, apiVersion: 'v1beta' });
  const r = await ai.interactions.create({
    model: cfg.model,
    ...(system ? { system_instruction: system } : {}),
    input: prompt,
    store: false,
  });
  return (r.output_text || '').trim();
}

// ---------------------------------------------------------------------------
// Adaptador 2: OpenAI (ChatGPT — Responses API + Files API)
// ---------------------------------------------------------------------------
async function openAiFetch(apiKey, endpoint, init = {}, timeoutMs = 45_000) {
  const res = await fetch(`https://api.openai.com/v1${endpoint}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const rawMsg = json?.error?.message || text || `HTTP ${res.status}`;
    const err = new Error(
      res.status === 401
        ? 'Chave da API OpenAI (ChatGPT) inválida ou sem permissão.'
        : `OpenAI (${res.status}): ${rawMsg}`,
    );
    err.status = res.status === 401 ? 400 : res.status >= 400 && res.status < 500 ? res.status : 502;
    throw err;
  }
  return json;
}

function extractOpenAiText(resp) {
  if (typeof resp?.output_text === 'string' && resp.output_text.trim()) return resp.output_text;
  const parts = [];
  for (const out of resp?.output || []) {
    if (out?.type === 'message' && Array.isArray(out.content)) {
      for (const c of out.content) {
        if (c?.type === 'output_text' && c.text) parts.push(c.text);
      }
    }
  }
  return parts.join('\n').trim();
}

async function toOpenAiContent(apiKey, items) {
  const content = [];
  for (const item of items) {
    if (item.kind === 'text') {
      content.push({ type: 'input_text', text: item.text });
    } else if (item.kind === 'pdf') {
      const filename = item.filename || 'documento.pdf';
      if (item.buffer.length <= INLINE_LIMIT) {
        content.push({
          type: 'input_file',
          filename,
          file_data: `data:application/pdf;base64,${item.buffer.toString('base64')}`,
        });
      } else {
        const form = new FormData();
        form.append('purpose', 'user_data');
        form.append('file', new Blob([item.buffer], { type: 'application/pdf' }), filename);
        const uploaded = await openAiFetch(apiKey, '/files', { method: 'POST', body: form }, 60_000);
        content.push({ type: 'input_file', file_id: uploaded.id });
      }
    } else if (item.kind === 'image') {
      const mime = item.mimeType || 'image/jpeg';
      content.push({
        type: 'input_image',
        image_url: `data:${mime};base64,${item.buffer.toString('base64')}`,
      });
    }
  }
  return content;
}

async function runOpenAiStructured(cfg, { system, items, schema, schemaName }) {
  const content = await toOpenAiContent(cfg.apiKey, items);
  const body = {
    model: cfg.model,
    instructions: system,
    input: [{ role: 'user', content }],
    text: {
      format: {
        type: 'json_schema',
        name: schemaName,
        strict: true,
        schema: makeStrictSchema(schema),
      },
    },
    background: true,
    store: true,
  };

  let resp;
  try {
    resp = await openAiFetch(
      cfg.apiKey,
      '/responses',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      45_000,
    );
  } catch (err) {
    if (err.status === 400 && /background|store/i.test(err.message || '')) {
      resp = await openAiFetch(
        cfg.apiKey,
        '/responses',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, background: false, store: false }),
        },
        240_000,
      );
      return { status: 'completed', output: extractOpenAiText(resp), model: resp.model || cfg.model };
    }
    throw err;
  }

  if (resp.status === 'completed') {
    return { status: 'completed', output: extractOpenAiText(resp), model: resp.model || cfg.model };
  }
  if (resp.status === 'failed' || resp.status === 'cancelled' || resp.status === 'incomplete') {
    throw new Error(resp.error?.message || `OpenAI encerrou com status "${resp.status}".`);
  }
  return { status: resp.status || 'in_progress', jobId: `openai:${resp.id}`, model: cfg.model };
}

async function pollOpenAiStructured(cfg, rawId) {
  const resp = await openAiFetch(cfg.apiKey, `/responses/${encodeURIComponent(rawId)}`, { method: 'GET' }, 20_000);
  if (resp.status === 'completed') {
    return { status: 'completed', output: extractOpenAiText(resp), model: resp.model || cfg.model };
  }
  if (resp.status === 'failed' || resp.status === 'cancelled' || resp.status === 'incomplete') {
    const err = new Error(resp.error?.message || `OpenAI encerrou com status "${resp.status}".`);
    err.status = 502;
    throw err;
  }
  return { status: resp.status || 'in_progress', jobId: `openai:${rawId}` };
}

async function runOpenAiText(cfg, { system, prompt }) {
  const resp = await openAiFetch(
    cfg.apiKey,
    '/responses',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        ...(system ? { instructions: system } : {}),
        input: prompt,
        store: false,
      }),
    },
    30_000,
  );
  return extractOpenAiText(resp);
}

// ---------------------------------------------------------------------------
// Adaptador 3: Anthropic (Claude — Messages API com leitura nativa de PDF e tool_use)
// ---------------------------------------------------------------------------
async function anthropicFetch(apiKey, body, timeoutMs = 240_000) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const rawMsg = json?.error?.message || text || `HTTP ${res.status}`;
    const err = new Error(
      res.status === 401
        ? 'Chave da API Anthropic (Claude) inválida ou sem permissão.'
        : `Anthropic (${res.status}): ${rawMsg}`,
    );
    err.status = res.status === 401 ? 400 : res.status >= 400 && res.status < 500 ? res.status : 502;
    throw err;
  }
  return json;
}

function toAnthropicContent(items) {
  const content = [];
  for (const item of items) {
    if (item.kind === 'text') {
      content.push({ type: 'text', text: item.text });
    } else if (item.kind === 'pdf') {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: item.buffer.toString('base64'),
        },
      });
    } else if (item.kind === 'image') {
      let mediaType = item.mimeType || 'image/jpeg';
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) mediaType = 'image/jpeg';
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: item.buffer.toString('base64'),
        },
      });
    }
  }
  return content;
}

async function runAnthropicStructured(cfg, { system, items, schema, schemaName }) {
  const content = toAnthropicContent(items);
  const tool = {
    name: schemaName,
    description: 'Retorna os dados extraídos do documento exatamente conforme o esquema JSON.',
    input_schema: makeStrictSchema(schema),
  };

  let resp;
  try {
    resp = await anthropicFetch(cfg.apiKey, {
      model: cfg.model,
      max_tokens: 16384,
      system,
      tools: [tool],
      tool_choice: { type: 'tool', name: schemaName },
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    if (err.status === 400 && /tool_choice/i.test(err.message || '')) {
      resp = await anthropicFetch(cfg.apiKey, {
        model: cfg.model,
        max_tokens: 16384,
        system: `${system}\nChame obrigatoriamente a ferramenta ${schemaName} com o resultado completo.`,
        tools: [tool],
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content }],
      });
    } else {
      throw err;
    }
  }

  const blocks = resp?.content || [];
  const toolBlock = blocks.find((b) => b.type === 'tool_use' && b.input);
  if (toolBlock) {
    return { status: 'completed', output: toolBlock.input, model: resp.model || cfg.model };
  }
  const textBlock = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { status: 'completed', output: textBlock, model: resp.model || cfg.model };
}

async function runAnthropicText(cfg, { system, prompt }) {
  const resp = await anthropicFetch(
    cfg.apiKey,
    {
      model: cfg.model,
      max_tokens: 1024,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    },
    30_000,
  );
  return (resp?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

// ---------------------------------------------------------------------------
// Dispatchers unificados
// ---------------------------------------------------------------------------
async function dispatchStructured(cfg, opts) {
  if (cfg.provider === 'openai') return runOpenAiStructured(cfg, opts);
  if (cfg.provider === 'anthropic') return runAnthropicStructured(cfg, opts);
  return runGeminiStructured(cfg, opts);
}

async function dispatchPoll(cfg, rawId) {
  if (cfg.provider === 'openai') return pollOpenAiStructured(cfg, rawId);
  return pollGeminiStructured(cfg, rawId);
}

async function dispatchText(cfg, opts) {
  if (cfg.provider === 'openai') return runOpenAiText(cfg, opts);
  if (cfg.provider === 'anthropic') return runAnthropicText(cfg, opts);
  return runGeminiText(cfg, opts);
}

// ---------------------------------------------------------------------------
// 1. Extração de Editais
// ---------------------------------------------------------------------------
function finalizeEditalData(output, { url = '', fontes = [], model = DEFAULT_MODEL, provider = 'gemini' } = {}) {
  const data = parseJsonResult(output);
  if (!data.url && url && fontes.includes('pagina')) data.url = url;
  if (!data.editalUrl && url && fontes.includes('pdf-url')) data.editalUrl = url;
  return { status: 'completed', data, fontes, model, provider };
}

export async function extractEdital(input, userId = null) {
  const cfg = await requireProviderConfig(userId);
  const items = [];
  const fontes = [];

  if (input.fileBuffer || input.fileBase64) {
    const buffer = input.fileBuffer || Buffer.from(input.fileBase64, 'base64');
    const mime = input.mimeType || 'application/pdf';
    if (mime === 'application/pdf') {
      items.push({ kind: 'pdf', buffer, filename: 'edital.pdf' });
    } else {
      items.push({ kind: 'text', text: `Conteúdo do arquivo enviado:\n${buffer.toString('utf8').slice(0, 400_000)}` });
    }
    fontes.push('arquivo');
  }

  if (input.url) {
    const page = await fetchPage(input.url, { maxBytes: 40 * 1024 * 1024 });
    if (page.isPdf) {
      items.push({ kind: 'pdf', buffer: page.buffer, filename: 'edital.pdf' });
      fontes.push('pdf-url');
    } else {
      const text = htmlToText(page.body);
      items.push({ kind: 'text', text: `Página do concurso (${input.url}):\n${text.slice(0, 200_000)}` });
      fontes.push('pagina');
      if (!input.fileBuffer && !input.fileBase64) {
        const links = extractLinks(page.body, page.finalUrl);
        const edital = links.find((l) => /\.pdf(\?|$)/i.test(l.href) && /edital|abertura/i.test(`${l.text} ${l.href}`) && !/retifica/i.test(`${l.text} ${l.href}`))
          || links.find((l) => /\.pdf(\?|$)/i.test(l.href) && /edital/i.test(`${l.text} ${l.href}`));
        if (edital) {
          try {
            const pdf = await fetchPage(edital.href, { maxBytes: 40 * 1024 * 1024 });
            if (pdf.isPdf) {
              items.push({ kind: 'pdf', buffer: pdf.buffer, filename: 'edital-linkado.pdf' });
              fontes.push(`edital-linkado:${edital.href}`);
            }
          } catch { /* segue apenas com a página */ }
        }
      }
    }
  }

  if (input.text?.trim()) {
    items.push({ kind: 'text', text: `Texto do edital informado pelo usuário:\n${input.text.slice(0, 400_000)}` });
    fontes.push('texto');
  }

  if (!items.length) {
    const err = new Error('Envie o PDF do edital, uma URL ou cole o texto.');
    err.status = 400;
    throw err;
  }

  items.push({
    kind: 'text',
    text: `Extraia as informações do concurso conforme o esquema.${input.url ? ` URL informada pelo usuário: ${input.url}` : ''}`,
  });

  const res = await dispatchStructured(cfg, {
    system: SYSTEM_EDITAL,
    items,
    schema: EDITAL_SCHEMA,
    schemaName: 'extrair_edital',
  });

  if (res.status === 'completed') {
    return finalizeEditalData(res.output, { url: input.url, fontes, model: res.model || cfg.model, provider: cfg.provider });
  }
  return {
    status: res.status || 'in_progress',
    jobId: res.jobId,
    fontes,
    model: res.model || cfg.model,
    provider: cfg.provider,
    url: input.url || '',
  };
}

export async function getEditalJobStatus(jobId, { url = '', fontes = [], userId = null } = {}) {
  const { provider, rawId } = parseJobId(jobId);
  const cfg = await requireProviderConfig(userId, provider);
  const res = await dispatchPoll(cfg, rawId);
  if (res.status === 'completed') {
    return finalizeEditalData(res.output, { url, fontes, model: res.model || cfg.model, provider });
  }
  return { status: res.status || 'in_progress', jobId, provider };
}

// ---------------------------------------------------------------------------
// 2. Extração de Gabaritos (Oficial e do Usuário)
// ---------------------------------------------------------------------------
function finalizeGabaritoData(output, { total, opcoesValidas, permiteX, isCE, model, provider }) {
  const parsed = parseJsonResult(output, 'A IA não conseguiu extrair o gabarito do arquivo enviado.');
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
    model,
    provider,
  };
}

export async function extractGabarito(input, userId = null) {
  if (!input?.fileBuffer && !input?.fileBase64) {
    const err = new Error('Envie um arquivo PDF, TXT ou imagem (JPG/PNG) do gabarito.');
    err.status = 400;
    throw err;
  }

  const cfg = await requireProviderConfig(userId);
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

  const items = [];
  if (mime === 'application/pdf') {
    items.push({ kind: 'pdf', buffer, filename: input.fileName || 'gabarito.pdf' });
  } else if (mime === 'image/jpeg' || mime === 'image/png' || mime.startsWith('image/')) {
    items.push({ kind: 'image', buffer, mimeType: mime.startsWith('image/') ? mime : 'image/jpeg' });
  } else if (mime === 'text/plain' || ext === 'txt') {
    items.push({ kind: 'text', text: `Conteúdo do arquivo de gabarito:\n${buffer.toString('utf8').slice(0, 400_000)}` });
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

  items.push({
    kind: 'text',
    text: `Extraia todas as respostas do gabarito presente no arquivo.\n\nContexto da prova:\n${contexto}\n\nInstruções:\n- Identifique cada número de questão (1 até ${total}) e sua respectiva resposta.\n- Caso o documento contenha gabaritos de vários cargos ou tipos de prova, priorize o cargo/prova informado no contexto (ou o primeiro gabarito compatível com ${total} questões).\n- Padronize cada resposta como uma única letra maiúscula dentre [${[...opcoesValidas, ...(permiteX ? ['X'] : [])].join(', ')}] ou "" se em branco.`,
  });

  const meta = { total, opcoesValidas, permiteX, isCE, model: cfg.model, provider: cfg.provider };
  const res = await dispatchStructured(cfg, {
    system: SYSTEM_GABARITO,
    items,
    schema: GABARITO_SCHEMA,
    schemaName: 'extrair_gabarito',
  });

  if (res.status === 'completed') {
    return finalizeGabaritoData(res.output, { ...meta, model: res.model || cfg.model });
  }
  return {
    status: res.status || 'in_progress',
    jobId: res.jobId,
    model: res.model || cfg.model,
    provider: cfg.provider,
  };
}

export async function getGabaritoJobStatus(jobId, opts, userId = null) {
  const { provider, rawId } = parseJobId(jobId);
  const cfg = await requireProviderConfig(userId, provider);
  const res = await dispatchPoll(cfg, rawId);

  const total = Math.max(1, Number(opts?.totalQuestoes) || 100);
  const isCE = opts?.tipoQuestao === 'certo_errado';
  const numAlt = Math.min(Math.max(Number(opts?.numAlternativas) || 5, 2), 6);
  const opcoesValidas = isCE ? ['C', 'E'] : 'ABCDEF'.slice(0, numAlt).split('');
  const permiteX = opts?.modo !== 'usuario';

  if (res.status === 'completed') {
    return finalizeGabaritoData(res.output, { total, opcoesValidas, permiteX, isCE, model: res.model || cfg.model, provider });
  }
  return { status: res.status || 'in_progress', jobId, provider };
}

// ---------------------------------------------------------------------------
// 3. Resumo de alterações no monitoramento & Teste de conexão
// ---------------------------------------------------------------------------
export async function summarizeChange({ orgao, added, removed, newLinks, userId = null }) {
  if (!(await aiAvailable(userId))) return '';
  try {
    const cfg = await requireProviderConfig(userId);
    const prompt = `Concurso: ${orgao}\n\nNovos links/documentos:\n${newLinks.map((l) => `- ${l.text} (${l.href})`).join('\n') || '(nenhum)'}\n\nTrechos adicionados:\n${added.join('\n').slice(0, 6000) || '(nenhum)'}\n\nTrechos removidos:\n${removed.join('\n').slice(0, 3000) || '(nenhum)'}\n\nResuma o que mudou.`;
    return await dispatchText(cfg, { system: SYSTEM_MONITOR, prompt });
  } catch (err) {
    console.warn('[ai] Falha ao resumir alteração:', err.message);
    return '';
  }
}

export async function testAi(userId = null, providerOverride = null) {
  const cfg = await requireProviderConfig(userId, providerOverride);
  const reply = await dispatchText(cfg, { prompt: 'Responda apenas: OK' });
  return { ok: true, provider: cfg.provider, providerLabel: cfg.providerLabel, model: cfg.model, reply };
}
