import { useEffect, useState } from 'react';
import { CalendarRange, Ticket, CalendarCheck, Clock, MapPin, FileText, Globe, Briefcase, Gift, ListChecks, CalendarClock, StickyNote, Sparkles, Check } from 'lucide-react';
import { fmtDate, fmtDateLong, money, daysUntil, relDays, parseDate } from '../lib/format.js';
import { useDebouncedCallback } from './ui.jsx';

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="fact">
      <span className="fact-icon"><Icon size={18} /></span>
      <div><span className="fact-label">{label}</span><div className="fact-value">{children || <span className="muted">Não informado</span>}</div></div>
    </div>
  );
}

function Block({ icon: Icon, title, children, count }) {
  return (
    <section className="card block">
      <h2 className="block-title"><Icon size={18} /> {title}{count ? <span className="count">{count}</span> : null}</h2>
      {children}
    </section>
  );
}

export default function OverviewTab({ c, onUpdate }) {
  const [notes, setNotes] = useState(c.anotacoes || '');
  const [savedNote, setSavedNote] = useState(true);
  useEffect(() => { setNotes(c.anotacoes || ''); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveNotes = useDebouncedCallback(async (v) => {
    try { await onUpdate({ anotacoes: v }); setSavedNote(true); } catch { /* toast já exibido */ }
  }, 900);

  const fim = daysUntil(c.inscricaoFim);
  const cronograma = [...(c.cronograma || [])].sort((a, b) => {
    const da = parseDate(a.data); const db = parseDate(b.data);
    if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
    return da - db;
  });
  const local = [...(c.cidades || []), c.uf && !(c.cidades || []).some((x) => x.includes(c.uf)) ? c.uf : ''].filter(Boolean).join(', ');

  return (
    <div className="overview">
      {c.resumo && (
        <div className="card resumo">
          <Sparkles size={18} />
          <p>{c.resumo}</p>
        </div>
      )}

      <section className="facts card">
        <Fact icon={CalendarRange} label="Inscrições">
          {(c.inscricaoInicio || c.inscricaoFim) && <>
            {fmtDate(c.inscricaoInicio) || '?'} a {fmtDate(c.inscricaoFim) || '?'}
            {fim !== null && fim >= 0 && <small className={fim <= 3 ? 'hot' : ''}> · encerra {relDays(fim)}</small>}
          </>}
        </Fact>
        <Fact icon={Ticket} label="Taxa de inscrição">{c.taxaInscricao}</Fact>
        <Fact icon={CalendarCheck} label="Data da prova">{c.dataProva && fmtDateLong(c.dataProva)}</Fact>
        <Fact icon={Clock} label="Turno / horário">
          {[c.turnoProva !== 'Não informado' ? c.turnoProva : '', c.horarioProva].filter(Boolean).join(' · ')}
        </Fact>
        <Fact icon={MapPin} label="Local de prova">{local}</Fact>
        <Fact icon={Globe} label="Links">
          {(c.url || c.editalUrl) && (
            <span className="links-inline">
              {c.url && <a href={c.url} target="_blank" rel="noreferrer">Página do concurso</a>}
              {c.editalUrl && <a href={c.editalUrl} target="_blank" rel="noreferrer"><FileText size={13} /> Edital</a>}
            </span>
          )}
        </Fact>
      </section>

      <div className="overview-grid">
        <div className="col-main">
          <Block icon={Briefcase} title="Cargos" count={c.cargos?.length}>
            {c.cargos?.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Cargo</th><th>Vagas</th><th>Escolaridade</th><th>Jornada</th><th className="num">Salário</th></tr></thead>
                  <tbody>
                    {c.cargos.map((cg, i) => (
                      <tr key={i}>
                        <td><strong>{cg.nome}</strong>{cg.requisitos && <div className="muted small">{cg.requisitos}</div>}</td>
                        <td>{cg.vagas || '—'}</td>
                        <td>{cg.escolaridade || '—'}</td>
                        <td>{cg.jornada || '—'}</td>
                        <td className="num strong">{money(cg.salario) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted">Nenhum cargo cadastrado. <a href={`#/concurso/${c.id}/editar`}>Adicionar</a></p>}
          </Block>

          <Block icon={ListChecks} title="Estrutura do certame">
            {c.estruturaProva?.length ? (
              <ol className="etapas">
                {c.estruturaProva.map((e, i) => (
                  <li key={i}>
                    <span className="etapa-n">{i + 1}</span>
                    <div>
                      <strong>{e.etapa}</strong>{e.carater && <span className="chip chip-soft">{e.carater}</span>}
                      {e.descricao && <p className="muted small">{e.descricao}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="muted">Nenhuma etapa cadastrada.</p>}
          </Block>

          {c.observacoes && (
            <Block icon={StickyNote} title="Outras informações">
              <p className="pre">{c.observacoes}</p>
            </Block>
          )}
        </div>

        <div className="col-side">
          <Block icon={Gift} title="Benefícios">
            {c.beneficios?.length
              ? <ul className="check-list">{c.beneficios.map((b) => <li key={b}><Check size={15} /> {b}</li>)}</ul>
              : <p className="muted">Nenhum benefício informado.</p>}
          </Block>

          <Block icon={CalendarClock} title="Cronograma">
            {cronograma.length ? (
              <ol className="timeline">
                {cronograma.map((e, i) => {
                  const d = daysUntil(e.data);
                  return (
                    <li key={i} className={d !== null && d < 0 ? 'past' : d !== null && d <= 7 ? 'soon' : ''}>
                      <span className="tl-date">{parseDate(e.data) ? fmtDate(e.data) : e.data}</span>
                      <span className="tl-event">{e.evento}</span>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="muted">Nenhum evento cadastrado.</p>}
          </Block>

          <Block icon={StickyNote} title="Minhas anotações">
            <textarea className="notes" rows={6} value={notes} placeholder="Estratégia de estudo, documentos para enviar, lembretes…"
              onChange={(e) => { setNotes(e.target.value); setSavedNote(false); saveNotes(e.target.value); }} />
            <span className="muted small save-state">{savedNote ? 'Salvo automaticamente' : 'Salvando…'}</span>
          </Block>
        </div>
      </div>
    </div>
  );
}
