import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellRing, CheckCheck, FileText, AlertTriangle, CalendarClock, Trash2, ExternalLink } from 'lucide-react';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { timeAgo } from '../lib/format.js';
import { useToast } from './ui.jsx';

const POLL_MS = 60 * 1000;
const ICONS = { alteracao: FileText, erro: AlertTriangle, lembrete: CalendarClock };

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ naoLidas: 0, itens: [] });
  const lastSeenId = useRef(null);
  const toast = useToast();
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await api.notificacoes();
      const newest = d.itens[0];
      // Avisa sobre notificações que chegaram enquanto o app está aberto.
      if (lastSeenId.current !== null && newest && newest.id !== lastSeenId.current && !newest.lida) {
        toast(newest.mensagem, {
          type: newest.tipo === 'erro' ? 'warning' : 'info',
          title: newest.titulo,
          duration: 9000,
          action: newest.concursoId ? { label: 'Ver concurso', onClick: () => navigate(`/concurso/${newest.concursoId}?aba=${newest.tipo === 'alteracao' ? 'monitor' : 'geral'}`) } : undefined,
        });
        window.dispatchEvent(new Event('jc:refresh'));
      }
      lastSeenId.current = newest?.id || '';
      setData(d);
    } catch { /* offline */ }
  }, [toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('jc:notificacoes', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('jc:notificacoes', onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markAll = async () => {
    await api.marcarLidas(null);
    load();
  };

  const openItem = async (n) => {
    if (!n.lida) await api.marcarLidas([n.id]);
    setOpen(false);
    load();
    if (n.concursoId) navigate(`/concurso/${n.concursoId}?aba=${n.tipo === 'alteracao' || n.tipo === 'erro' ? 'monitor' : 'geral'}`);
  };

  const remove = async (e, n) => {
    e.stopPropagation();
    await api.excluirNotificacao(n.id);
    load();
  };

  const Icon = data.naoLidas ? BellRing : Bell;
  return (
    <div className="notif" ref={ref}>
      <button className={`icon-btn ${data.naoLidas ? 'has-unread' : ''}`} onClick={() => setOpen((o) => !o)}
        aria-label={`Notificações${data.naoLidas ? ` (${data.naoLidas} não lidas)` : ''}`} aria-expanded={open}>
        <Icon size={19} />
        {data.naoLidas > 0 && <span className="notif-count">{data.naoLidas > 99 ? '99+' : data.naoLidas}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notificações">
          <div className="notif-head">
            <strong>Notificações</strong>
            {data.naoLidas > 0 && <button className="link-btn" onClick={markAll}><CheckCheck size={15} /> Marcar todas como lidas</button>}
          </div>
          <div className="notif-list">
            {data.itens.length === 0 && (
              <div className="notif-empty">
                <Bell size={28} />
                <p>Nenhuma notificação ainda.</p>
                <span className="muted small">Avisaremos aqui sobre alterações nas páginas dos concursos e prazos importantes.</span>
              </div>
            )}
            {data.itens.map((n) => {
              const I = ICONS[n.tipo] || Bell;
              return (
                <div key={n.id} role="button" tabIndex={0} className={`notif-item ${n.lida ? '' : 'unread'} tone-${n.tipo}`}
                  onClick={() => openItem(n)} onKeyDown={(e) => e.key === 'Enter' && openItem(n)}>
                  <span className="notif-icon"><I size={17} /></span>
                  <div className="notif-content">
                    <div className="notif-title">{n.titulo}{n.prioridade === 'alta' && <span className="pill-hot">Importante</span>}</div>
                    <p>{n.mensagem}</p>
                    {n.detalhes?.novosLinks?.length > 0 && (
                      <ul className="notif-links">
                        {n.detalhes.novosLinks.slice(0, 3).map((l) => (
                          <li key={l.href}>
                            <a href={l.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                              <ExternalLink size={12} /> {l.text}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                    <span className="notif-time">{timeAgo(n.createdAt)}</span>
                  </div>
                  <button className="icon-btn sm notif-del" aria-label="Excluir notificação" onClick={(e) => remove(e, n)}><Trash2 size={14} /></button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
