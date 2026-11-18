import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { db, isPostgresConfigured, ensureSchema } from './db.js';
import {
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  extractTokenFromReq,
  setSessionCookie,
  clearSessionCookie,
} from './auth.js';
import {
  extractEdital,
  getEditalJobStatus,
  extractGabarito,
  getGabaritoJobStatus,
  getAllProvidersConfig,
  testAi,
  PROVIDERS,
  PROVIDER_IDS,
  DEFAULT_MODEL,
} from './ai.js';
import { checkConcurso, runAll, startScheduler, isRunning, DEFAULT_HORARIOS } from './monitor.js';

const app = express();
const PORT = Number(process.env.PORT || 5174);
app.use(express.json({ limit: '60mb' }));

// Remove dados internos volumosos do monitor antes de enviar ao cliente.
function publicConcurso(c, { full = false } = {}) {
  if (!c) return c;
  const { linhas, links, historico, ...mon } = c.monitor || {};
  return {
    ...c,
    monitor: c.monitor ? { ...mon, totalLinks: links?.length || 0, historico: full ? historico || [] : (historico || []).slice(0, 1) } : undefined,
  };
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    nome: u.nome,
    sobrenome: u.sobrenome || '',
    email: u.email,
    createdAt: u.createdAt,
  };
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Middleware de autenticação para rotas privadas
const requireAuth = wrap(async (req, res, next) => {
  const token = extractTokenFromReq(req);
  const payload = verifySessionToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Sessão expirada ou não autenticada. Faça login para continuar.' });
  }
  const user = await db.getUserById(payload.sub);
  if (!user) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Usuário não encontrado. Faça login novamente.' });
  }
  req.user = user;
  next();
});

// ----------------------------- Autenticação -----------------------------
app.post('/api/auth/register', wrap(async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const sobrenome = String(req.body?.sobrenome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!nome) throw Object.assign(new Error('Informe o seu nome.'), { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('Informe um endereço de e-mail válido.'), { status: 400 });
  }

  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    throw Object.assign(new Error(strength.message), { status: 400 });
  }

  const existing = await db.getUserByEmail(email);
  if (existing) {
    throw Object.assign(new Error('Já existe uma conta cadastrada com este e-mail.'), { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await db.createUser({ nome, sobrenome, email, passwordHash });
  const token = signSessionToken(user);
  setSessionCookie(res, token);
  res.status(201).json({ user: publicUser(user), token });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    throw Object.assign(new Error('Informe seu e-mail e senha.'), { status: 400 });
  }

  const user = await db.getUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw Object.assign(new Error('E-mail ou senha inválidos.'), { status: 401 });
  }

  const token = signSessionToken(user);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user), token });
}));

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

app.get('/api/auth/me', wrap(async (req, res) => {
  const token = extractTokenFromReq(req);
  const payload = verifySessionToken(token);
  if (!payload) return res.json({ user: null });
  const user = await db.getUserById(payload.sub);
  if (!user) {
    clearSessionCookie(res);
    return res.json({ user: null });
  }
  res.json({ user: publicUser(user) });
}));

// Suporte a Vercel Cron Jobs (GET /api/monitor/executar) — executa sobre todos os usuários
app.get('/api/monitor/executar', wrap(async (req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'Uma verificação já está em andamento.' });
  res.json(await runAll('cron', null));
}));

// Campos que o cliente pode gravar em um concurso.
const ALLOWED = [
  'orgao', 'sigla', 'banca', 'url', 'editalUrl', 'numeroEdital', 'cidades', 'uf', 'inscricaoInicio', 'inscricaoFim',
  'taxaInscricao', 'dataProva', 'turnoProva', 'horarioProva', 'cargos', 'beneficios', 'estruturaProva', 'cronograma',
  'provas', 'observacoes', 'resumo', 'origem', 'favorito', 'inscrito', 'arquivado', 'cargoInteresse', 'cor', 'anotacoes',
];
const pick = (body) => Object.fromEntries(Object.entries(body || {}).filter(([k]) => ALLOWED.includes(k)));

function validate(data, partial = false) {
  if (!partial && !String(data.orgao || '').trim()) throw Object.assign(new Error('Informe o nome do órgão.'), { status: 400 });
  if (data.url) {
    try { new URL(data.url); } catch { throw Object.assign(new Error('URL do concurso inválida.'), { status: 400 }); }
  }
}

// ----------------------------- Concursos (isolados por usuário) -----------------------------
app.get('/api/concursos', requireAuth, wrap(async (req, res) => {
  const list = await db.listConcursos(req.user.id);
  res.json(list.map((c) => publicConcurso(c)));
}));

app.get('/api/concursos/:id', requireAuth, wrap(async (req, res) => {
  const c = await db.getConcurso(req.user.id, req.params.id);
  if (!c) return res.status(404).json({ error: 'Concurso não encontrado.' });
  res.json(publicConcurso(c, { full: true }));
}));

app.post('/api/concursos', requireAuth, wrap(async (req, res) => {
  const data = pick(req.body);
  validate(data);
  const c = await db.createConcurso(req.user.id, { origem: 'manual', ...data, monitor: data.url ? { ativo: true } : undefined });
  res.status(201).json(publicConcurso(c, { full: true }));
  if (c.url) checkConcurso(req.user.id, c.id).catch(() => {});
}));

app.put('/api/concursos/:id', requireAuth, wrap(async (req, res) => {
  const current = await db.getConcurso(req.user.id, req.params.id);
  if (!current) return res.status(404).json({ error: 'Concurso não encontrado.' });
  const data = pick(req.body);
  validate({ ...current, ...data }, true);
  const urlChanged = 'url' in data && data.url !== current.url;
  if (urlChanged) data.monitor = data.url ? { ativo: true } : undefined;
  const c = await db.updateConcurso(req.user.id, req.params.id, data);
  res.json(publicConcurso(c, { full: true }));
  if (urlChanged && c.url) checkConcurso(req.user.id, c.id).catch(() => {});
}));

app.delete('/api/concursos/:id', requireAuth, wrap(async (req, res) => {
  const ok = await db.deleteConcurso(req.user.id, req.params.id);
  res.status(ok ? 204 : 404).end();
}));

// ----------------------------- Monitoramento -----------------------------
app.post('/api/concursos/:id/verificar', requireAuth, wrap(async (req, res) => {
  const r = await checkConcurso(req.user.id, req.params.id, { manual: true });
  const updated = await db.getConcurso(req.user.id, req.params.id);
  res.json({ ...r, concurso: publicConcurso(updated, { full: true }) });
}));

app.put('/api/concursos/:id/monitor', requireAuth, wrap(async (req, res) => {
  const c = await db.getConcurso(req.user.id, req.params.id);
  if (!c) return res.status(404).json({ error: 'Concurso não encontrado.' });
  const monitor = { ...(c.monitor || {}) };
  if (typeof req.body.ativo === 'boolean') monitor.ativo = req.body.ativo;
  if (req.body.marcarVisto) monitor.alteracoesNaoVistas = 0;
  const updated = await db.updateConcurso(req.user.id, c.id, { monitor });
  res.json(publicConcurso(updated, { full: true }));
}));

app.post('/api/monitor/executar', requireAuth, wrap(async (req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'Uma verificação já está em andamento.' });
  res.json(await runAll('manual', req.user.id));
}));

// ----------------------------- Notificações -----------------------------
app.get('/api/notificacoes', requireAuth, wrap(async (req, res) => {
  const list = await db.listNotificacoes(req.user.id);
  res.json({ naoLidas: list.filter((n) => !n.lida).length, itens: list.slice(0, 100) });
}));
app.post('/api/notificacoes/lidas', requireAuth, wrap(async (req, res) => {
  await db.markNotificacoes(req.user.id, req.body?.ids || null, true);
  res.status(204).end();
}));
app.delete('/api/notificacoes/:id', requireAuth, wrap(async (req, res) => {
  await db.deleteNotificacao(req.user.id, req.params.id);
  res.status(204).end();
}));

// ----------------------------- IA -----------------------------
app.post('/api/ia/extrair', requireAuth, wrap(async (req, res) => {
  const { fileBase64, mimeType, text, url } = req.body || {};
  const result = await extractEdital({ fileBase64, mimeType, text, url: url?.trim() || undefined }, req.user.id);
  res.status(result.status === 'completed' ? 200 : 202).json(result);
}));

app.post(
  '/api/ia/extrair-arquivo',
  requireAuth,
  express.raw({ type: ['application/pdf', 'text/plain', 'text/html', 'application/octet-stream'], limit: '45mb' }),
  wrap(async (req, res) => {
    const fileBuffer = Buffer.isBuffer(req.body) && req.body.length ? req.body : null;
    const mimeType = req.headers['x-file-mime'] ? decodeURIComponent(String(req.headers['x-file-mime'])) : (req.headers['content-type'] || 'application/pdf').split(';')[0];
    const url = req.headers['x-concurso-url'] ? decodeURIComponent(String(req.headers['x-concurso-url'])).trim() : undefined;
    const result = await extractEdital({ fileBuffer, mimeType, url }, req.user.id);
    res.status(result.status === 'completed' ? 200 : 202).json(result);
  }),
);

app.post('/api/ia/status/:id', requireAuth, wrap(async (req, res) => {
  const { url = '', fontes = [] } = req.body || {};
  res.json(await getEditalJobStatus(req.params.id, { url, fontes, userId: req.user.id }));
}));

app.post('/api/ia/extrair-gabarito', requireAuth, wrap(async (req, res) => {
  const result = await extractGabarito(req.body || {}, req.user.id);
  res.status(result.status === 'completed' ? 200 : 202).json(result);
}));

app.post('/api/ia/gabarito-status/:id', requireAuth, wrap(async (req, res) => {
  res.json(await getGabaritoJobStatus(req.params.id, req.body || {}, req.user.id));
}));

app.post('/api/ia/testar', requireAuth, wrap(async (req, res) => {
  const provider = typeof req.body?.provider === 'string' && PROVIDERS[req.body.provider] ? req.body.provider : null;
  res.json(await testAi(req.user.id, provider));
}));

// ----------------------------- Configurações -----------------------------
function maskKey(k) {
  if (!k) return '';
  if (k.length <= 10) return '••••••';
  return `${k.slice(0, 5)}…${k.slice(-4)}`;
}

async function publicSettings(userId) {
  const s = await db.getSettings(userId);
  const { active, providers } = await getAllProvidersConfig(userId);
  const activeEntry = providers[active];

  const publicProviders = {};
  for (const id of PROVIDER_IDS) {
    const p = providers[id];
    publicProviders[id] = {
      id: p.id,
      label: p.label,
      shortLabel: p.shortLabel,
      disponivel: Boolean(p.apiKey),
      chaveOrigem: p.source,
      chaveMascarada: maskKey(p.apiKey),
      model: p.model,
      modeloPadrao: p.defaultModel,
      suggestedModels: p.suggestedModels,
      docsUrl: p.docsUrl,
      docsLabel: p.docsLabel,
    };
  }

  return {
    aiProvider: active,
    aiProviderLabel: activeEntry.label,
    aiProviderShortLabel: activeEntry.shortLabel,
    iaDisponivel: Boolean(activeEntry.apiKey),
    providers: publicProviders,
    // Campos legados mantidos por compatibilidade
    chaveOrigem: activeEntry.source,
    chaveMascarada: maskKey(activeEntry.apiKey),
    geminiModel: providers.gemini.model,
    modeloPadrao: DEFAULT_MODEL,
    monitorHorarios: s.monitorHorarios?.length ? s.monitorHorarios : DEFAULT_HORARIOS,
    ultimaRodadaMonitor: s.ultimaRodadaMonitor || null,
    monitorExecutando: isRunning(),
    bancoDados: isPostgresConfigured() ? 'Neon Postgres (Nuvem)' : 'Arquivo JSON Local',
  };
}

app.get('/api/config', requireAuth, wrap(async (req, res) => {
  res.json(await publicSettings(req.user.id));
}));

app.put('/api/config', requireAuth, wrap(async (req, res) => {
  const patch = {};
  const b = req.body || {};
  if (typeof b.aiProvider === 'string' && PROVIDERS[b.aiProvider]) {
    patch.aiProvider = b.aiProvider;
  }
  for (const id of PROVIDER_IDS) {
    const { settingsKey, settingsModel } = PROVIDERS[id];
    if (typeof b[settingsKey] === 'string') patch[settingsKey] = b[settingsKey].trim();
    if (typeof b[settingsModel] === 'string') patch[settingsModel] = b[settingsModel].trim();
  }
  if (Array.isArray(b.monitorHorarios)) {
    const valid = [...new Set(b.monitorHorarios.filter((h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h)))].sort();
    if (!valid.length) throw Object.assign(new Error('Informe ao menos um horário válido (HH:MM).'), { status: 400 });
    patch.monitorHorarios = valid;
  }
  await db.updateSettings(req.user.id, patch);
  res.json(await publicSettings(req.user.id));
}));

// ----------------------------- Backup -----------------------------
app.get('/api/backup', requireAuth, wrap(async (req, res) => {
  const list = await db.listConcursos(req.user.id);
  res.setHeader('Content-Disposition', `attachment; filename="jornada-concurseiro-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ versao: 1, exportadoEm: new Date().toISOString(), concursos: list.map((c) => publicConcurso(c, { full: true })) });
}));

app.post('/api/backup', requireAuth, wrap(async (req, res) => {
  const list = Array.isArray(req.body?.concursos) ? req.body.concursos : null;
  if (!list) throw Object.assign(new Error('Arquivo de backup inválido.'), { status: 400 });
  let n = 0;
  for (const c of list) {
    if (!c?.orgao) continue;
    await db.createConcurso(req.user.id, { ...pick(c), monitor: c.url ? { ativo: true } : undefined });
    n++;
  }
  res.json({ importados: n });
}));

// ----------------------------- Front-end (produção) -----------------------------
const dist = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const isUpstreamAiAuth = req.path.startsWith('/api/ia/') && (err.status === 401 || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(err.message || ''));
  const status = isUpstreamAiAuth ? 400 : (err.status || (err.type === 'entity.too.large' ? 413 : 500));
  const causeMsg = err.cause?.cause?.message || err.cause?.message || '';
  if (status >= 500) console.error('[api]', err, causeMsg ? `(causa: ${causeMsg})` : '');
  const message = err.type === 'entity.too.large'
    ? 'Arquivo muito grande (máx. ~40 MB).'
    : /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(err.message || '')
      ? 'Chave da API Gemini inválida ou sem permissão.'
      : isUpstreamAiAuth && !/inválida/i.test(err.message || '')
        ? 'Chave da API de IA inválida ou sem permissão.'
        : causeMsg && !err.message.includes(causeMsg)
          ? `${err.message} (${causeMsg})`
          : err.message || 'Erro interno.';
  res.status(status).json({ error: message });
});

// Em ambiente serverless (Vercel), exporta o app; localmente, inicia o servidor HTTP.
if (!process.env.VERCEL) {
  const server = app.listen(PORT, async () => {
    if (isPostgresConfigured()) {
      await ensureSchema().catch((e) => console.error('[db] Erro ao inicializar tabelas no Neon Postgres:', e.message));
    }
    console.log(`\n  🎯 Jornada do Concurseiro — API em http://localhost:${PORT}`);
    console.log(`  Banco de dados: ${isPostgresConfigured() ? 'Neon Postgres (conectado)' : 'Arquivo JSON local'}`);
    startScheduler();
  });
  server.requestTimeout = 15 * 60 * 1000;
  server.headersTimeout = 15 * 60 * 1000 + 5000;
  server.timeout = 15 * 60 * 1000;
}

export default app;
