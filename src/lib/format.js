// Formatação e regras de status (datas no formato AAAA-MM-DD).

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlShort = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);
export const parseDate = (s) => (isIsoDate(s) ? new Date(`${s.slice(0, 10)}T00:00:00`) : null);

export function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysUntil(s) {
  const d = parseDate(s);
  return d ? Math.round((d - today()) / 86400000) : null;
}

export function fmtDate(s, opts = {}) {
  const d = parseDate(s);
  if (!d) return s || '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: opts.short ? undefined : 'numeric' });
}

export function fmtDateLong(s) {
  const d = parseDate(s);
  if (!d) return s || '';
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'agora mesmo';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  const d = Math.floor(diff / 86400);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

export const money = (v) => (Number(v) > 0 ? brl.format(Number(v)) : '');
export const moneyShort = (v) => (Number(v) > 0 ? brlShort.format(Number(v)) : '');

export function salaryRange(cargos = []) {
  const vals = cargos.map((c) => Number(c.salario) || 0).filter((v) => v > 0);
  if (!vals.length) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return { min, max, label: min === max ? money(max) : `${moneyShort(min)} a ${moneyShort(max)}` };
}

export function relDays(n) {
  if (n === null || n === undefined) return '';
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}

/** Situação do concurso para exibição. */
export function getStatus(c) {
  const ini = daysUntil(c.inscricaoInicio);
  const fim = daysUntil(c.inscricaoFim);
  const prova = daysUntil(c.dataProva);
  if (c.arquivado) return { key: 'arquivado', label: 'Arquivado', tone: 'muted' };
  if (prova !== null && prova < 0) return { key: 'realizada', label: 'Prova realizada', tone: 'muted' };
  if (prova === 0) return { key: 'hoje', label: 'Prova hoje', tone: 'danger' };
  if (fim !== null && fim >= 0 && (ini === null || ini <= 0)) {
    return { key: 'abertas', label: fim <= 3 ? 'Inscrições encerrando' : 'Inscrições abertas', tone: fim <= 3 ? 'warning' : 'success' };
  }
  if (ini !== null && ini > 0) return { key: 'em_breve', label: 'Inscrições em breve', tone: 'info' };
  if (fim !== null && fim < 0) return { key: 'encerradas', label: prova !== null ? 'Aguardando prova' : 'Inscrições encerradas', tone: 'primary' };
  return { key: 'previsto', label: 'Datas a definir', tone: 'muted' };
}

/** Percentual decorrido do período de inscrição (0–100) ou null. */
export function inscricaoProgress(c) {
  const a = parseDate(c.inscricaoInicio);
  const b = parseDate(c.inscricaoFim);
  if (!a || !b || b <= a) return null;
  const pct = ((today() - a) / (b - a)) * 100;
  return Math.max(0, Math.min(100, pct));
}

export function initials(c) {
  if (c.sigla) return c.sigla.slice(0, 4).toUpperCase();
  const words = (c.orgao || '?').split(/\s+/).filter((w) => w.length > 2 && !/^(de|da|do|das|dos)$/i.test(w));
  return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase() || '?';
}

const HUES = [243, 199, 160, 25, 330, 280, 12, 45, 185, 262];
export function hueFor(text = '') {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export const BANCAS = ['Cebraspe', 'FGV', 'FCC', 'Vunesp', 'Cesgranrio', 'IBFC', 'Quadrix', 'AOCP', 'Idecan', 'Consulplan', 'IBADE', 'Fundatec', 'FUNDEP', 'Instituto Mais', 'Selecon', 'IADES', 'Cebraspe/UnB', 'Comperve', 'FAFIPA', 'Avança SP'];
export const UFS = ['Nacional', 'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
export const TURNOS = ['Manhã', 'Tarde', 'Noite', 'Manhã e Tarde', 'Integral', 'Não informado'];
export const ESCOLARIDADES = ['Fundamental', 'Médio', 'Técnico', 'Superior', 'Pós-graduação'];
