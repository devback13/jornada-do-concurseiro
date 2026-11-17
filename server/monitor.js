// Monitoramento das páginas de inscrição (2x ao dia por padrão) + lembretes de prazos.
import crypto from 'node:crypto';
import { db, now } from './db.js';
import { fetchPage, htmlToText, extractLinks } from './web.js';
import { summarizeChange } from './ai.js';

export const DEFAULT_HORARIOS = ['08:00', '20:00'];
const MAX_LINES = 4000;
const MAX_HIST = 40;
let running = false;

// Remove trechos voláteis (relógios, contadores, tokens) que gerariam falsos positivos.
function normalizeLine(line) {
  return line
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '')
    .replace(/\b(acessos?|visitas?|visualiza[çc][õo]es)\s*:?\s*\d+/gi, '')
    .replace(/[a-f0-9]{24,}/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function snapshot(page) {
  if (page.isPdf) {
    const hash = crypto.createHash('sha256').update(page.buffer).digest('hex');
    return { hash, lines: [`[PDF] ${page.buffer.length} bytes`], links: [] };
  }
  const text = htmlToText(page.body);
  const lines = [...new Set(text.split('\n').map(normalizeLine).filter((l) => l.length > 2))].slice(0, MAX_LINES);
  const links = extractLinks(page.body, page.finalUrl)
    .filter((l) => !/^(javascript|mailto):/i.test(l.href))
    .slice(0, 800);
  const hash = crypto.createHash('sha256').update(lines.join('\n')).update(links.map((l) => l.href).join('\n')).digest('hex');
  return { hash, lines, links };
}

const IMPORTANT = /edital|retifica|prorroga|resultado|gabarito|convoca|local de prova|cart[ãa]o|homologa|inscri|isen[çc][ãa]o|recurso|cronograma|suspens|cancel|adiad|nomea/i;

export async function checkConcurso(userId, id, { manual = false } = {}) {
  const c = await db.getConcurso(userId, id);
  if (!c) throw Object.assign(new Error('Concurso não encontrado.'), { status: 404 });
  if (!c.url) throw Object.assign(new Error('Este concurso não possui URL para monitorar.'), { status: 400 });
  const ownerId = userId || c.userId;

  const prev = c.monitor || {};
  const mon = { ativo: prev.ativo !== false, ...prev, ultimaVerificacao: now() };
  const historico = [...(prev.historico || [])];
  let resultado = { alterado: false };

  try {
    const page = await fetchPage(c.url);
    const snap = snapshot(page);
    mon.erro = null;
    mon.falhas = 0;

    if (!prev.hash) {
      historico.unshift({ data: now(), tipo: 'inicial', resumo: `Monitoramento iniciado. ${snap.links.length} links e ${snap.lines.length} trechos registrados.` });
    } else if (prev.hash !== snap.hash) {
      const oldLines = new Set(prev.linhas || []);
      const newLines = new Set(snap.lines);
      const oldLinks = new Set((prev.links || []).map((l) => l.href));
      const adicionados = snap.lines.filter((l) => !oldLines.has(l));
      const removidos = (prev.linhas || []).filter((l) => !newLines.has(l));
      const novosLinks = snap.links.filter((l) => !oldLinks.has(l.href));

      if (adicionados.length || removidos.length || novosLinks.length) {
        const relevantes = [...novosLinks.map((l) => l.text), ...adicionados].filter((t) => IMPORTANT.test(t));
        const ia = await summarizeChange({ orgao: c.orgao, added: adicionados.slice(0, 80), removed: removidos.slice(0, 40), newLinks: novosLinks.slice(0, 30), userId: ownerId });
        const partes = [];
        if (novosLinks.length) partes.push(`${novosLinks.length} novo(s) link(s)/documento(s)`);
        if (adicionados.length) partes.push(`${adicionados.length} trecho(s) adicionado(s)`);
        if (removidos.length) partes.push(`${removidos.length} trecho(s) removido(s)`);
        const destaque = relevantes[0] || novosLinks[0]?.text;
        const resumo = ia || `Detectado(s): ${partes.join(', ')}.${destaque ? ` Destaque: “${destaque.slice(0, 160)}”.` : ''}`;

        const entry = {
          data: now(),
          tipo: 'alteracao',
          resumo,
          estatisticas: partes.join(' · '),
          relevante: relevantes.length > 0,
          novosLinks: novosLinks.slice(0, 15),
          adicionados: adicionados.slice(0, 20),
          removidos: removidos.slice(0, 10),
        };
        historico.unshift(entry);
        mon.ultimaAlteracao = now();
        mon.alteracoesNaoVistas = (prev.alteracoesNaoVistas || 0) + 1;
        await db.addNotificacao(ownerId, {
          concursoId: c.id,
          tipo: 'alteracao',
          prioridade: relevantes.length ? 'alta' : 'normal',
          titulo: `Alteração na página: ${c.sigla || c.orgao}`,
          mensagem: resumo,
          detalhes: { novosLinks: entry.novosLinks.slice(0, 5), adicionados: entry.adicionados.slice(0, 5) },
        });
        resultado = { alterado: true, entry };
      }
    }

    mon.hash = snap.hash;
    mon.linhas = snap.lines;
    mon.links = snap.links;
  } catch (err) {
    mon.erro = err.message;
    mon.falhas = (prev.falhas || 0) + 1;
    historico.unshift({ data: now(), tipo: 'erro', resumo: `Falha ao acessar a página: ${err.message}` });
    if (mon.falhas === 2) {
      await db.addNotificacao(ownerId, {
        concursoId: c.id,
        tipo: 'erro',
        prioridade: 'normal',
        titulo: `Não foi possível verificar: ${c.sigla || c.orgao}`,
        mensagem: `A página do concurso falhou em 2 verificações seguidas (${err.message}). Confira se a URL ainda é válida.`,
      });
    }
    resultado = { alterado: false, erro: err.message };
    if (manual) {
      await db.updateConcurso(ownerId, id, { monitor: { ...mon, historico: historico.slice(0, MAX_HIST) } });
      throw Object.assign(new Error(`Falha ao acessar a página: ${err.message}`), { status: 502 });
    }
  }

  mon.historico = historico.slice(0, MAX_HIST);
  await db.updateConcurso(ownerId, id, { monitor: mon });
  return resultado;
}

// ---------------------------------------------------------------------------
// Lembretes de prazos (inscrições encerrando, prova chegando)
// ---------------------------------------------------------------------------
const dayDiff = (iso) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Math.round((d - today) / 86400000);
};

export async function checkLembretes(userId = null) {
  const list = userId ? await db.listConcursos(userId) : await db.listAllConcursosForMonitor();
  for (const c of list) {
    if (c.arquivado || !c.userId) continue;
    const enviados = new Set(c.lembretesEnviados || []);
    const novos = [];
    const add = async (key, titulo, mensagem) => {
      if (enviados.has(key)) return;
      await db.addNotificacao(c.userId, { concursoId: c.id, tipo: 'lembrete', prioridade: 'alta', titulo, mensagem });
      novos.push(key);
    };
    const fim = dayDiff(c.inscricaoFim);
    if (fim !== null && fim >= 0 && fim <= 3 && c.inscrito !== true) {
      await add(`insc-${c.inscricaoFim}`, `Inscrições encerrando: ${c.sigla || c.orgao}`, fim === 0 ? 'As inscrições encerram hoje!' : `As inscrições encerram em ${fim} dia(s).`);
    }
    const prova = dayDiff(c.dataProva);
    if (prova !== null && prova >= 0 && prova <= 7) {
      await add(`prova-${c.dataProva}`, `Prova se aproximando: ${c.sigla || c.orgao}`, prova === 0 ? 'A prova é hoje. Boa prova!' : `Faltam ${prova} dia(s) para a prova${c.turnoProva && c.turnoProva !== 'Não informado' ? ` (turno: ${c.turnoProva})` : ''}.`);
    }
    if (novos.length) await db.updateConcurso(c.userId, c.id, { lembretesEnviados: [...enviados, ...novos] });
  }
}

export async function runAll(reason = 'agendado', userId = null) {
  if (running) return { skipped: true };
  running = true;
  const started = Date.now();
  let verificados = 0; let alterados = 0; let erros = 0;
  try {
    const list = userId ? await db.listConcursos(userId) : await db.listAllConcursosForMonitor();
    const touchedUsers = new Set();
    if (userId) touchedUsers.add(userId);

    for (const c of list) {
      if (!c.url || c.arquivado || c.monitor?.ativo === false || !c.userId) continue;
      touchedUsers.add(c.userId);
      try {
        const r = await checkConcurso(c.userId, c.id);
        verificados++;
        if (r.alterado) alterados++;
        if (r.erro) erros++;
      } catch (err) {
        erros++;
        console.warn(`[monitor] ${c.orgao}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    await checkLembretes(userId);
    for (const uid of touchedUsers) {
      await db.updateSettings(uid, { ultimaRodadaMonitor: now() });
    }
  } finally {
    running = false;
  }
  console.log(`[monitor] Rodada (${reason}) concluída em ${((Date.now() - started) / 1000).toFixed(1)}s — ${verificados} verificados, ${alterados} alterados, ${erros} erros.`);
  return { verificados, alterados, erros };
}

export function startScheduler() {
  const slotsRun = new Set();
  const tick = () => {
    const horarios = DEFAULT_HORARIOS;
    const d = new Date();
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const key = `${d.toDateString()} ${hhmm}`;
    if (horarios.includes(hhmm) && !slotsRun.has(key)) {
      slotsRun.add(key);
      runAll(`agendado ${hhmm}`).catch((e) => console.error('[monitor]', e));
    }
  };
  setInterval(tick, 30 * 1000);

  setTimeout(() => {
    checkLembretes().catch(() => {});
  }, 10 * 1000);
}

export const isRunning = () => running;
