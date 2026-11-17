import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { db } from './db.js';
import { extractEdital, extractGabarito, aiAvailable, getAiConfig, testAi, DEFAULT_MODEL } from './ai.js';
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

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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

// ----------------------------- Concursos -----------------------------
app.get('/api/concursos', (req, res) => {
  res.json(db.listConcursos().map((c) => publicConcurso(c)));
});

app.get('/api/concursos/:id', (req, res) => {
  const c = db.getConcurso(req.params.id);
  if (!c) return res.status(404).json({ error: 'Concurso não encontrado.' });
  res.json(publicConcurso(c, { full: true }));
});

app.post('/api/concursos', wrap(async (req, res) => {
  const data = pick(req.body);
  validate(data);
  const c = await db.createConcurso({ origem: 'manual', ...data, monitor: data.url ? { ativo: true } : undefined });
  res.status(201).json(publicConcurso(c, { full: true }));
  // Captura a versão inicial da página para comparações futuras.
  if (c.url) checkConcurso(c.id).catch(() => {});
}));

app.put('/api/concursos/:id', wrap(async (req, res) => {
  const current = db.getConcurso(req.params.id);
  if (!current) return res.status(404).json({ error: 'Concurso não encontrado.' });
  const data = pick(req.body);
  validate({ ...current, ...data }, true);
  const urlChanged = 'url' in data && data.url !== current.url;
  if (urlChanged) data.monitor = data.url ? { ativo: true } : undefined;
  const c = await db.updateConcurso(req.params.id, data);
  res.json(publicConcurso(c, { full: true }));
  if (urlChanged && c.url) checkConcurso(c.id).catch(() => {});
}));

app.delete('/api/concursos/:id', wrap(async (req, res) => {
  const ok = await db.deleteConcurso(req.params.id);
  res.status(ok ? 204 : 404).end();
}));

// ----------------------------- Monitoramento -----------------------------
app.post('/api/concursos/:id/verificar', wrap(async (req, res) => {
  const r = await checkConcurso(req.params.id, { manual: true });
  res.json({ ...r, concurso: publicConcurso(db.getConcurso(req.params.id), { full: true }) });
}));

app.put('/api/concursos/:id/monitor', wrap(async (req, res) => {
  const c = db.getConcurso(req.params.id);
  if (!c) return res.status(404).json({ error: 'Concurso não encontrado.' });
  const monitor = { ...(c.monitor || {}) };
  if (typeof req.body.ativo === 'boolean') monitor.ativo = req.body.ativo;
  if (req.body.marcarVisto) monitor.alteracoesNaoVistas = 0;
  const updated = await db.updateConcurso(c.id, { monitor });
  res.json(publicConcurso(updated, { full: true }));
}));

app.post('/api/monitor/executar', wrap(async (req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'Uma verificação já está em andamento.' });
  res.json(await runAll('manual'));
}));

// Suporte a Vercel Cron Jobs (GET /api/monitor/executar)
app.get('/api/monitor/executar', wrap(async (req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'Uma verificação já está em andamento.' });
  res.json(await runAll('cron'));
}));

// ----------------------------- Notificações -----------------------------
app.get('/api/notificacoes', (req, res) => {
  const list = db.listNotificacoes();
  res.json({ naoLidas: list.filter((n) => !n.lida).length, itens: list.slice(0, 100) });
});
app.post('/api/notificacoes/lidas', wrap(async (req, res) => {
  await db.markNotificacoes(req.body?.ids || null, true);
  res.status(204).end();
}));
app.delete('/api/notificacoes/:id', wrap(async (req, res) => {
  await db.deleteNotificacao(req.params.id);
  res.status(204).end();
}));

// ----------------------------- IA -----------------------------
app.post('/api/ia/extrair', wrap(async (req, res) => {
  const { fileBase64, mimeType, text, url } = req.body || {};
  res.json(await extractEdital({ fileBase64, mimeType, text, url: url?.trim() || undefined }));
}));

app.post('/api/ia/extrair-gabarito', wrap(async (req, res) => {
  res.json(await extractGabarito(req.body || {}));
}));

app.post('/api/ia/testar', wrap(async (req, res) => {
  res.json(await testAi());
}));

// ----------------------------- Configurações -----------------------------
function publicSettings() {
  const s = db.getSettings();
  const { apiKey, model } = getAiConfig();
  return {
    iaDisponivel: aiAvailable(),
    chaveOrigem: s.geminiApiKey ? 'app' : apiKey ? 'env' : null,
    chaveMascarada: apiKey ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : '',
    geminiModel: model,
    modeloPadrao: DEFAULT_MODEL,
    monitorHorarios: s.monitorHorarios?.length ? s.monitorHorarios : DEFAULT_HORARIOS,
    ultimaRodadaMonitor: s.ultimaRodadaMonitor || null,
    monitorExecutando: isRunning(),
  };
}

app.get('/api/config', (req, res) => res.json(publicSettings()));

app.put('/api/config', wrap(async (req, res) => {
  const patch = {};
  const b = req.body || {};
  if (typeof b.geminiApiKey === 'string') patch.geminiApiKey = b.geminiApiKey.trim();
  if (typeof b.geminiModel === 'string') patch.geminiModel = b.geminiModel.trim();
  if (Array.isArray(b.monitorHorarios)) {
    const valid = [...new Set(b.monitorHorarios.filter((h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h)))].sort();
    if (!valid.length) throw Object.assign(new Error('Informe ao menos um horário válido (HH:MM).'), { status: 400 });
    patch.monitorHorarios = valid;
  }
  await db.updateSettings(patch);
  res.json(publicSettings());
}));

// ----------------------------- Backup -----------------------------
app.get('/api/backup', (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="jornada-concurseiro-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ versao: 1, exportadoEm: new Date().toISOString(), concursos: db.listConcursos().map((c) => publicConcurso(c, { full: true })) });
});

app.post('/api/backup', wrap(async (req, res) => {
  const list = Array.isArray(req.body?.concursos) ? req.body.concursos : null;
  if (!list) throw Object.assign(new Error('Arquivo de backup inválido.'), { status: 400 });
  let n = 0;
  for (const c of list) {
    if (!c?.orgao) continue;
    await db.createConcurso({ ...pick(c), monitor: c.url ? { ativo: true } : undefined });
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
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  const causeMsg = err.cause?.cause?.message || err.cause?.message || '';
  if (status >= 500) console.error('[api]', err, causeMsg ? `(causa: ${causeMsg})` : '');
  const message = err.type === 'entity.too.large'
    ? 'Arquivo muito grande (máx. ~40 MB).'
    : /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(err.message || '')
      ? 'Chave da API Gemini inválida ou sem permissão.'
      : causeMsg && !err.message.includes(causeMsg)
        ? `${err.message} (${causeMsg})`
        : err.message || 'Erro interno.';
  res.status(status).json({ error: message });
});

// Em ambiente serverless (Vercel), exporta o app; localmente, inicia o servidor HTTP.
if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`\n  🎯 Jornada do Concurseiro — API em http://localhost:${PORT}`);
    console.log(`  IA: ${aiAvailable() ? `ativa (${getAiConfig().model})` : 'chave não configurada (defina GEMINI_API_KEY ou use Configurações)'}`);
    startScheduler();
  });
  // Permite até 15 minutos para leitura de editais extensos pela IA
  server.requestTimeout = 15 * 60 * 1000;
  server.headersTimeout = 15 * 60 * 1000 + 5000;
  server.timeout = 15 * 60 * 1000;
}

export default app;
