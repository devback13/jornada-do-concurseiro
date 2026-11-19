import { useEffect, useState } from 'react';
import { Radar, RefreshCw, Globe, AlertTriangle, FileText, Plus, Minus, ExternalLink, Clock, CheckCircle2, Activity, Link2, Sparkles, ChevronDown, Send } from 'lucide-react';
import { api } from '../lib/api.js';
import { fmtDateTime, timeAgo } from '../lib/format.js';
import { useConfig } from '../lib/configContext.js';
import { EmptyState, Badge, useToast } from './ui.jsx';

function proximaVerificacao(horarios = ['08:00', '20:00']) {
  const now = new Date();
  const candidatos = [0, 1].flatMap((add) => horarios.map((h) => {
    const [hh, mm] = h.split(':').map(Number);
    const d = new Date(now);
    d.setDate(d.getDate() + add);
    d.setHours(hh, mm, 0, 0);
    return d;
  })).filter((d) => d > now).sort((a, b) => a - b);
  return candidatos[0];
}

function HistItem({ h }) {
  const [open, setOpen] = useState(false);
  const Icon = h.tipo === 'alteracao' ? Activity : h.tipo === 'erro' ? AlertTriangle : CheckCircle2;
  const hasDetails = h.novosLinks?.length || h.adicionados?.length || h.removidos?.length;
  return (
    <li className={`hist hist-${h.tipo} ${h.relevante ? 'relevante' : ''}`}>
      <span className="hist-icon"><Icon size={16} /></span>
      <div className="hist-body">
        <div className="hist-head">
          <strong>{h.tipo === 'alteracao' ? 'Alteração detectada' : h.tipo === 'erro' ? 'Falha na verificação' : 'Monitoramento iniciado'}</strong>
          {h.relevante && <Badge tone="warning">Possivelmente importante</Badge>}
          <span className="muted small" title={fmtDateTime(h.data)}>{fmtDateTime(h.data)} · {timeAgo(h.data)}</span>
        </div>
        <p>{h.resumo}</p>
        {h.estatisticas && <span className="muted small">{h.estatisticas}</span>}
        {hasDetails ? (
          <>
            <button className="link-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? 'Ocultar detalhes' : 'Ver detalhes'} <ChevronDown size={14} className={open ? 'rot' : ''} />
            </button>
            {open && (
              <div className="hist-details">
                {h.novosLinks?.length > 0 && (
                  <div>
                    <h4><Link2 size={14} /> Novos links / documentos</h4>
                    <ul className="diff-links">
                      {h.novosLinks.map((l) => (
                        <li key={l.href}><a href={l.href} target="_blank" rel="noreferrer">{/\.pdf/i.test(l.href) ? <FileText size={14} /> : <ExternalLink size={14} />} {l.text}</a></li>
                      ))}
                    </ul>
                  </div>
                )}
                {h.adicionados?.length > 0 && (
                  <div>
                    <h4><Plus size={14} /> Trechos adicionados</h4>
                    <ul className="diff add">{h.adicionados.map((t, i) => <li key={i}>{t}</li>)}</ul>
                  </div>
                )}
                {h.removidos?.length > 0 && (
                  <div>
                    <h4><Minus size={14} /> Trechos removidos</h4>
                    <ul className="diff del">{h.removidos.map((t, i) => <li key={i}>{t}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
    </li>
  );
}

export default function MonitorTab({ concurso: c, setConcurso }) {
  const [checking, setChecking] = useState(false);
  const { config } = useConfig();
  const toast = useToast();
  const m = c.monitor || {};
  const ativo = m.ativo !== false;

  useEffect(() => {
    if (m.alteracoesNaoVistas > 0) {
      api.setMonitor(c.id, { marcarVisto: true }).then((x) => { setConcurso(x); window.dispatchEvent(new Event('jc:notificacoes')); }).catch(() => {});
    }
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c.url) {
    return (
      <EmptyState icon={Radar} title="Adicione a página do concurso para monitorá-la"
        actions={<a className="btn btn-primary" href={`#/concurso/${c.id}/editar`}><Globe size={17} /> Informar URL</a>}>
        Verificamos a página de inscrição duas vezes por dia e avisamos você quando algo mudar — novos editais, retificações, prorrogações, locais de prova e resultados.
      </EmptyState>
    );
  }

  const verificar = async () => {
    setChecking(true);
    try {
      const r = await api.verificar(c.id);
      setConcurso(r.concurso);
      toast(r.alterado ? 'Alteração detectada! Confira o histórico.' : 'Nenhuma alteração desde a última verificação.', { type: r.alterado ? 'warning' : 'success' });
      if (r.alterado) window.dispatchEvent(new Event('jc:notificacoes'));
    } catch (e) {
      toast(e.message, { type: 'error' });
      api.getConcurso(c.id).then(setConcurso).catch(() => {});
    } finally {
      setChecking(false);
    }
  };

  const toggle = async () => {
    try {
      setConcurso(await api.setMonitor(c.id, { ativo: !ativo }));
      toast(ativo ? 'Monitoramento pausado.' : 'Monitoramento reativado.');
    } catch (e) { toast(e.message, { type: 'error' }); }
  };

  const prox = proximaVerificacao(config?.monitorHorarios);
  const historico = m.historico || [];

  return (
    <div className="monitor">
      <section className="card monitor-status">
        <div className={`radar ${ativo ? (m.erro ? 'err' : 'on') : 'off'}`}><Radar size={26} /></div>
        <div className="monitor-info">
          <h3>{ativo ? (m.erro ? 'Monitoramento com falhas' : 'Monitoramento ativo') : 'Monitoramento pausado'}</h3>
          <a href={c.url} target="_blank" rel="noreferrer" className="url-line"><Globe size={14} /> {c.url}</a>
          <div className="monitor-meta">
            <span><Clock size={14} /> Última verificação: <strong>{m.ultimaVerificacao ? `${fmtDateTime(m.ultimaVerificacao)} (${timeAgo(m.ultimaVerificacao)})` : 'ainda não verificada'}</strong></span>
            {ativo && prox && <span><RefreshCw size={14} /> Próxima: <strong>{fmtDateTime(prox.toISOString())}</strong></span>}
            {m.ultimaAlteracao && <span><Activity size={14} /> Última alteração: <strong>{timeAgo(m.ultimaAlteracao)}</strong></span>}
            {m.totalLinks > 0 && <span><Link2 size={14} /> {m.totalLinks} links acompanhados</span>}
          </div>
          {config && (
            <p className="muted small">
              Verificações automáticas às {(config.monitorHorarios || []).join(' e ')}
              {config.iaDisponivel && <> · <Sparkles size={12} /> resumos das alterações gerados por {config.aiProviderLabel || 'IA'}</>}
              {config.telegram?.pronto && <> · <Send size={12} /> alertas no Telegram ativos ({config.telegram.telefone || 'vinculado'})</>}.
            </p>
          )}
        </div>
        <div className="monitor-actions">
          <button className="btn btn-primary" onClick={verificar} disabled={checking}>
            <RefreshCw size={17} className={checking ? 'spin' : ''} /> {checking ? 'Verificando…' : 'Verificar agora'}
          </button>
          <label className="switch">
            <input type="checkbox" checked={ativo} onChange={toggle} />
            <span className="switch-ui" />
            <span>Automático</span>
          </label>
        </div>
      </section>

      {m.erro && (
        <div className="alert alert-error"><AlertTriangle size={18} /> Última tentativa falhou: {m.erro}</div>
      )}

      <section className="card">
        <h3 className="block-title"><Activity size={18} /> Histórico</h3>
        {historico.length === 0
          ? <p className="muted">Nenhuma verificação registrada ainda. Clique em “Verificar agora” para capturar a versão atual da página.</p>
          : <ol className="hist-list">{historico.map((h, i) => <HistItem key={`${h.data}-${i}`} h={h} />)}</ol>}
      </section>
    </div>
  );
}
