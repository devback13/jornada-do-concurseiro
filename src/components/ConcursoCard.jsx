import { MapPin, CalendarRange, Clock, Briefcase, Wallet, Star, Radar, ChevronRight, Sparkles, CheckCircle2 } from 'lucide-react';
import { getStatus, fmtDate, daysUntil, relDays, salaryRange, inscricaoProgress, initials, hueFor } from '../lib/format.js';
import { Badge } from './ui.jsx';

export default function ConcursoCard({ c, onToggleFavorito }) {
  const status = getStatus(c);
  const salario = salaryRange(c.cargos);
  const progress = status.key === 'abertas' ? inscricaoProgress(c) : null;
  const fim = daysUntil(c.inscricaoFim);
  const prova = daysUntil(c.dataProva);
  const cargos = c.cargos || [];
  const local = [...(c.cidades || [])].slice(0, 2).join(', ') + ((c.cidades || []).length > 2 ? ` +${c.cidades.length - 2}` : '');
  const hue = hueFor(c.sigla || c.orgao);
  const alteracoes = c.monitor?.alteracoesNaoVistas || 0;
  const href = `#/concurso/${c.id}`;

  return (
    <article className={`ccard ${status.key === 'realizada' || c.arquivado ? 'is-past' : ''}`} style={{ '--hue': hue }}>
      <a href={href} className="ccard-link" aria-label={`Abrir ${c.orgao}`} />
      <header className="ccard-head">
        <div className="avatar" aria-hidden>{initials(c)}</div>
        <div className="ccard-title">
          <h3 title={c.orgao}>{c.orgao}</h3>
          <div className="ccard-sub">
            {c.banca ? <span className="chip-banca">{c.banca}</span> : <span className="muted small">Banca a definir</span>}
            {c.origem === 'ia' && <span className="ia-tag" title="Cadastrado com IA"><Sparkles size={12} /> IA</span>}
          </div>
        </div>
        <button className={`icon-btn star ${c.favorito ? 'on' : ''}`} onClick={(e) => { e.preventDefault(); onToggleFavorito?.(c); }}
          aria-label={c.favorito ? 'Remover dos favoritos' : 'Favoritar'} aria-pressed={!!c.favorito}>
          <Star size={18} fill={c.favorito ? 'currentColor' : 'none'} />
        </button>
      </header>

      <div className="ccard-badges">
        <Badge tone={status.tone} dot>{status.label}</Badge>
        {c.inscrito && <Badge tone="success"><CheckCircle2 size={12} /> Inscrito</Badge>}
        {alteracoes > 0 && <Badge tone="warning" className="pulse"><Radar size={12} /> Página alterada</Badge>}
      </div>

      <dl className="ccard-info">
        <div>
          <dt><MapPin size={15} /><span className="sr-only">Local</span></dt>
          <dd>{local || c.uf || <span className="muted">Local a definir</span>}{local && c.uf && c.uf !== 'Nacional' && !local.includes(c.uf) ? ` · ${c.uf}` : ''}</dd>
        </div>
        <div>
          <dt><CalendarRange size={15} /><span className="sr-only">Inscrições</span></dt>
          <dd>
            {c.inscricaoInicio || c.inscricaoFim
              ? <>{fmtDate(c.inscricaoInicio, { short: true }) || '?'} – {fmtDate(c.inscricaoFim) || '?'}</>
              : <span className="muted">Inscrições a definir</span>}
            {status.key === 'abertas' && fim !== null && <span className={`when ${fim <= 3 ? 'hot' : ''}`}>encerra {relDays(fim)}</span>}
          </dd>
        </div>
        <div>
          <dt><Clock size={15} /><span className="sr-only">Prova</span></dt>
          <dd>
            {c.dataProva ? <>Prova {fmtDate(c.dataProva)}</> : <span className="muted">Prova a definir</span>}
            {c.turnoProva && c.turnoProva !== 'Não informado' && <span className="turno">{c.turnoProva}</span>}
            {prova !== null && prova >= 0 && prova <= 60 && <span className="when">{relDays(prova)}</span>}
          </dd>
        </div>
        <div>
          <dt><Briefcase size={15} /><span className="sr-only">Cargos</span></dt>
          <dd className="cargos">
            {cargos.length === 0 && <span className="muted">Cargos não informados</span>}
            {cargos.slice(0, 3).map((cg, i) => <span key={i} className="chip" title={cg.nome}>{cg.nome}</span>)}
            {cargos.length > 3 && <span className="chip chip-more">+{cargos.length - 3}</span>}
          </dd>
        </div>
      </dl>

      {progress !== null && (
        <div className="progress" aria-label={`Período de inscrição ${Math.round(progress)}% decorrido`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      )}

      <footer className="ccard-foot">
        <div className="salary">
          <Wallet size={16} />
          {salario ? <span><small>{salario.min === salario.max ? 'Salário' : 'Salários'}</small>{salario.label}</span> : <span className="muted">Salário não informado</span>}
        </div>
        <span className="ccard-go" aria-hidden><ChevronRight size={18} /></span>
      </footer>
    </article>
  );
}
