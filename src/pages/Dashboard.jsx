import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Sparkles, PenLine, CalendarCheck, Radar, Trophy, Layers, SlidersHorizontal, Inbox } from 'lucide-react';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { getStatus, daysUntil, fmtDateLong, relDays, salaryRange } from '../lib/format.js';
import ConcursoCard from '../components/ConcursoCard.jsx';
import { EmptyState, Spinner, useToast } from '../components/ui.jsx';

const FILTERS = [
  { value: 'todos', label: 'Todos' },
  { value: 'abertas', label: 'Inscrições abertas' },
  { value: 'em_breve', label: 'Em breve' },
  { value: 'aguardando', label: 'Aguardando prova' },
  { value: 'realizada', label: 'Realizados' },
  { value: 'favoritos', label: 'Favoritos' },
  { value: 'arquivado', label: 'Arquivados' },
];

const SORTS = [
  { value: 'prova', label: 'Data da prova' },
  { value: 'inscricao', label: 'Fim das inscrições' },
  { value: 'salario', label: 'Maior salário' },
  { value: 'recentes', label: 'Cadastrados recentemente' },
  { value: 'nome', label: 'Nome do órgão' },
];

const far = (d) => (d === null || d < 0 ? Infinity : d);

export default function Dashboard({ user }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState(() => sessionStorage.getItem('jc-filter') || 'todos');
  const [sort, setSort] = useState(() => sessionStorage.getItem('jc-sort') || 'prova');
  const toast = useToast();

  const load = useCallback(() => api.listConcursos().then(setList).catch((e) => { setList([]); toast(e.message, { type: 'error' }); }), [toast]);
  useEffect(() => {
    load();
    window.addEventListener('jc:refresh', load);
    return () => window.removeEventListener('jc:refresh', load);
  }, [load]);
  useEffect(() => { sessionStorage.setItem('jc-filter', filter); sessionStorage.setItem('jc-sort', sort); }, [filter, sort]);

  const toggleFav = async (c) => {
    setList((l) => l.map((x) => (x.id === c.id ? { ...x, favorito: !x.favorito } : x)));
    try { await api.updateConcurso(c.id, { favorito: !c.favorito }); } catch (e) { toast(e.message, { type: 'error' }); load(); }
  };

  const stats = useMemo(() => {
    if (!list) return null;
    const ativos = list.filter((c) => !c.arquivado);
    const abertas = ativos.filter((c) => getStatus(c).key === 'abertas');
    const proximas = ativos.map((c) => ({ c, d: daysUntil(c.dataProva) })).filter((x) => x.d !== null && x.d >= 0).sort((a, b) => a.d - b.d);
    const alteracoes = ativos.reduce((s, c) => s + (c.monitor?.alteracoesNaoVistas || 0), 0);
    const monitorados = ativos.filter((c) => c.url && c.monitor?.ativo !== false).length;
    return { total: ativos.length, abertas, proxima: proximas[0], alteracoes, monitorados };
  }, [list]);

  const visible = useMemo(() => {
    if (!list) return [];
    const term = q.trim().toLowerCase();
    let out = list.filter((c) => {
      const st = getStatus(c).key;
      if (filter === 'arquivado') { if (!c.arquivado) return false; } else if (c.arquivado) return false;
      if (filter === 'abertas' && st !== 'abertas') return false;
      if (filter === 'em_breve' && st !== 'em_breve') return false;
      if (filter === 'aguardando' && st !== 'encerradas' && st !== 'hoje') return false;
      if (filter === 'realizada' && st !== 'realizada') return false;
      if (filter === 'favoritos' && !c.favorito) return false;
      if (!term) return true;
      const hay = [c.orgao, c.sigla, c.banca, c.uf, ...(c.cidades || []), ...(c.cargos || []).map((x) => x.nome)].join(' ').toLowerCase();
      return hay.includes(term);
    });
    const cmp = {
      prova: (a, b) => far(daysUntil(a.dataProva)) - far(daysUntil(b.dataProva)),
      inscricao: (a, b) => far(daysUntil(a.inscricaoFim)) - far(daysUntil(b.inscricaoFim)),
      salario: (a, b) => (salaryRange(b.cargos)?.max || 0) - (salaryRange(a.cargos)?.max || 0),
      recentes: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
      nome: (a, b) => (a.orgao || '').localeCompare(b.orgao || '', 'pt-BR'),
    }[sort];
    out = [...out].sort((a, b) => (Number(!!b.favorito) - Number(!!a.favorito)) || cmp(a, b));
    return out;
  }, [list, q, filter, sort]);

  if (!list) return <div className="page-loading"><Spinner size={28} label="Carregando seus concursos…" /></div>;

  if (list.length === 0) {
    return (
      <section className="welcome">
        <div className="welcome-hero">
          <span className="eyebrow">Olá, {user?.nome || 'Concurseiro(a)'} · Bem-vindo(a) à sua jornada</span>
          <h1>Todos os seus concursos, organizados em um só lugar.</h1>
          <p>Cadastre um certame enviando o edital — nossa IA identifica órgão, banca, datas, cargos, salários e a estrutura das provas. Depois é só acompanhar: monitoramos a página do concurso duas vezes por dia e avisamos você sobre qualquer novidade.</p>
          <div className="welcome-actions">
            <button className="btn btn-primary btn-lg" onClick={() => navigate('/novo?modo=ia')}><Sparkles size={19} /> Cadastrar com IA</button>
            <button className="btn btn-outline btn-lg" onClick={() => navigate('/novo?modo=manual')}><PenLine size={19} /> Cadastrar manualmente</button>
          </div>
        </div>
        <div className="welcome-steps">
          {[
            [Sparkles, 'Leitura do edital', 'Envie o PDF ou link e revise os dados extraídos pela IA.'],
            [Radar, 'Monitoramento 2x ao dia', 'Alterações na página de inscrição viram notificações.'],
            [Trophy, 'Gabaritos e notas', 'Cadastre a prova, o gabarito oficial e o seu: a nota sai na hora.'],
          ].map(([I, t, d]) => (
            <div className="step-card" key={t}><span className="step-icon"><I size={22} /></span><strong>{t}</strong><p>{d}</p></div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="page-head">
        <div>
          <h1>Meus concursos</h1>
          <p className="muted">Acompanhe prazos, provas e novidades dos certames que você quer conquistar.</p>
        </div>
      </section>

      <section className="stats" aria-label="Resumo">
        <div className="stat">
          <span className="stat-icon i-primary"><Layers size={20} /></span>
          <div><strong>{stats.total}</strong><span>Concursos ativos</span></div>
        </div>
        <button className="stat stat-btn" onClick={() => setFilter('abertas')}>
          <span className="stat-icon i-success"><CalendarCheck size={20} /></span>
          <div><strong>{stats.abertas.length}</strong><span>Com inscrições abertas</span></div>
        </button>
        <a className="stat stat-btn" href={stats.proxima ? `#/concurso/${stats.proxima.c.id}` : undefined}>
          <span className="stat-icon i-warning"><Trophy size={20} /></span>
          <div>
            {stats.proxima
              ? <><strong>{relDays(stats.proxima.d)}</strong><span title={stats.proxima.c.orgao}>Próxima prova · {stats.proxima.c.sigla || stats.proxima.c.orgao} · {fmtDateLong(stats.proxima.c.dataProva)}</span></>
              : <><strong>—</strong><span>Nenhuma prova agendada</span></>}
          </div>
        </a>
        <div className="stat">
          <span className={`stat-icon ${stats.alteracoes ? 'i-danger' : 'i-info'}`}><Radar size={20} /></span>
          <div><strong>{stats.alteracoes}</strong><span>{stats.alteracoes === 1 ? 'Alteração não vista' : 'Alterações não vistas'} · {stats.monitorados} página(s) monitorada(s)</span></div>
        </div>
      </section>

      <section className="toolbar" aria-label="Filtros">
        <div className="search">
          <Search size={18} />
          <input type="search" placeholder="Buscar por órgão, banca, cargo ou cidade…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar concursos" />
        </div>
        <div className="sort">
          <SlidersHorizontal size={16} />
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar por">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </section>
      <div className="filters" role="tablist" aria-label="Situação">
        {FILTERS.map((f) => (
          <button key={f.value} role="tab" aria-selected={filter === f.value} className={`filter-chip ${filter === f.value ? 'active' : ''}`} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={Inbox} title="Nenhum concurso encontrado" actions={<button className="btn btn-ghost" onClick={() => { setQ(''); setFilter('todos'); }}>Limpar filtros</button>}>
          Ajuste a busca ou os filtros para ver outros certames.
        </EmptyState>
      ) : (
        <section className="grid" aria-label="Concursos">
          {visible.map((c) => <ConcursoCard key={c.id} c={c} onToggleFavorito={toggleFav} />)}
        </section>
      )}
    </>
  );
}
