import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Pencil, Trash2, Star, ExternalLink, LayoutDashboard, ClipboardList, Radar, CheckCircle2, Archive, ArchiveRestore, MoreHorizontal, Sparkles, FileText } from 'lucide-react';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { getStatus, initials, hueFor, daysUntil, relDays } from '../lib/format.js';
import { Badge, Spinner, Tabs, ConfirmDialog, EmptyState, useToast } from '../components/ui.jsx';
import OverviewTab from '../components/OverviewTab.jsx';
import ProvasTab from '../components/ProvasTab.jsx';
import MonitorTab from '../components/MonitorTab.jsx';

export default function ConcursoDetail({ id, tab = 'geral' }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [menu, setMenu] = useState(false);
  const toast = useToast();

  const load = useCallback(() => api.getConcurso(id).then(setC).catch((e) => setErr(e.message)), [id]);
  useEffect(() => {
    load();
    window.addEventListener('jc:refresh', load);
    return () => window.removeEventListener('jc:refresh', load);
  }, [load]);

  const update = async (patch, msg) => {
    const prev = c;
    setC((x) => ({ ...x, ...patch }));
    try {
      const saved = await api.updateConcurso(id, patch);
      setC(saved);
      if (msg) toast(msg);
      return saved;
    } catch (e) {
      setC(prev);
      toast(e.message, { type: 'error' });
      throw e;
    }
  };

  const remove = async () => {
    try {
      await api.deleteConcurso(id);
      toast('Concurso excluído.');
      navigate('/', { replace: true });
    } catch (e) { toast(e.message, { type: 'error' }); }
  };

  if (err) return <EmptyState icon={FileText} title="Concurso não encontrado" actions={<a className="btn btn-primary" href="#/">Voltar aos concursos</a>}>{err}</EmptyState>;
  if (!c) return <div className="page-loading"><Spinner size={28} label="Carregando…" /></div>;

  const status = getStatus(c);
  const prova = daysUntil(c.dataProva);
  const setTab = (t) => navigate(`/concurso/${id}?aba=${t}`, { replace: true });
  const pendentes = c.monitor?.alteracoesNaoVistas || 0;

  return (
    <div className="detail">
      <a href="#/" className="back-link"><ArrowLeft size={16} /> Meus concursos</a>
      <header className="detail-hero card" style={{ '--hue': hueFor(c.sigla || c.orgao) }}>
        <div className="avatar lg" aria-hidden>{initials(c)}</div>
        <div className="detail-title">
          <div className="row gap-sm wrap">
            <Badge tone={status.tone} dot>{status.label}</Badge>
            {c.banca && <span className="chip-banca">{c.banca}</span>}
            {c.origem === 'ia' && <span className="ia-tag"><Sparkles size={12} /> Cadastrado com IA</span>}
            {c.inscrito && <Badge tone="success"><CheckCircle2 size={12} /> Inscrito</Badge>}
          </div>
          <h1>{c.orgao}{c.sigla && <span className="sigla"> · {c.sigla}</span>}</h1>
          {c.numeroEdital && <p className="muted">{c.numeroEdital}</p>}
          {prova !== null && prova >= 0 && <p className="countdown"><strong>{prova === 0 ? 'A prova é hoje!' : `Faltam ${prova} dia${prova > 1 ? 's' : ''}`}</strong> {prova > 0 && <span className="muted">para a prova ({relDays(prova)})</span>}</p>}
        </div>
        <div className="detail-actions">
          <button className={`btn ${c.inscrito ? 'btn-success-soft' : 'btn-outline'}`} onClick={() => update({ inscrito: !c.inscrito }, c.inscrito ? 'Inscrição desmarcada.' : 'Marcado como inscrito. Boa sorte!')}>
            <CheckCircle2 size={17} /> {c.inscrito ? 'Inscrito' : 'Marcar inscrição'}
          </button>
          <button className={`icon-btn star bordered ${c.favorito ? 'on' : ''}`} onClick={() => update({ favorito: !c.favorito })} aria-label="Favoritar" aria-pressed={!!c.favorito}>
            <Star size={18} fill={c.favorito ? 'currentColor' : 'none'} />
          </button>
          <a className="btn btn-outline" href={`#/concurso/${id}/editar`}><Pencil size={16} /> Editar</a>
          <div className="menu-wrap">
            <button className="icon-btn bordered" onClick={() => setMenu((m) => !m)} aria-label="Mais ações" aria-expanded={menu}><MoreHorizontal size={18} /></button>
            {menu && (
              <div className="menu" onMouseLeave={() => setMenu(false)}>
                {c.url && <a href={c.url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Abrir página do concurso</a>}
                {c.editalUrl && <a href={c.editalUrl} target="_blank" rel="noreferrer"><FileText size={16} /> Abrir edital</a>}
                <button onClick={() => { setMenu(false); update({ arquivado: !c.arquivado }, c.arquivado ? 'Concurso restaurado.' : 'Concurso arquivado.'); }}>
                  {c.arquivado ? <><ArchiveRestore size={16} /> Desarquivar</> : <><Archive size={16} /> Arquivar</>}
                </button>
                <button className="danger" onClick={() => { setMenu(false); setConfirmDel(true); }}><Trash2 size={16} /> Excluir concurso</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'geral', label: 'Visão geral', icon: LayoutDashboard },
        { value: 'provas', label: 'Provas e gabaritos', icon: ClipboardList, badge: c.provas?.length || 0 },
        { value: 'monitor', label: 'Monitoramento', icon: Radar, badge: pendentes },
      ]} />

      <div className="tab-panel">
        {tab === 'provas' && <ProvasTab concurso={c} onSave={(provas) => update({ provas })} />}
        {tab === 'monitor' && <MonitorTab concurso={c} setConcurso={setC} />}
        {(tab === 'geral' || !['provas', 'monitor'].includes(tab)) && <OverviewTab c={c} onUpdate={update} />}
      </div>

      <ConfirmDialog open={confirmDel} danger title="Excluir concurso?" confirmLabel="Excluir"
        message={`"${c.orgao}" será removido junto com provas, gabaritos e histórico de monitoramento. Essa ação não pode ser desfeita.`}
        onCancel={() => setConfirmDel(false)} onConfirm={remove} />
    </div>
  );
}
