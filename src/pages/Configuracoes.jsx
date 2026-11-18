import { useEffect, useRef, useState } from 'react';
import {
  KeyRound, Eye, EyeOff, Radar, Plus, X, Save, Loader2, Zap, Download, Upload,
  Database, CheckCircle2, RefreshCw, Sparkles, Check, Bot, Cpu,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useConfig } from '../lib/configContext.js';
import { fmtDateTime } from '../lib/format.js';
import { Field, Spinner, useToast } from '../components/ui.jsx';

const PROVIDER_META = [
  { id: 'gemini', title: 'Google Gemini', sub: 'Gemini 3.8 / 4', keyField: 'geminiApiKey', modelField: 'geminiModel', icon: Sparkles, accent: 'p-gemini', placeholder: 'AIza…' },
  { id: 'openai', title: 'ChatGPT (OpenAI)', sub: 'GPT-6 / GPT-5 / 4o', keyField: 'openaiApiKey', modelField: 'openaiModel', icon: Bot, accent: 'p-openai', placeholder: 'sk-…' },
  { id: 'anthropic', title: 'Claude (Anthropic)', sub: 'Claude 5.5 / 4.5', keyField: 'anthropicApiKey', modelField: 'anthropicModel', icon: Cpu, accent: 'p-anthropic', placeholder: 'sk-ant-…' },
];

export default function Configuracoes({ user }) {
  const { config, reload } = useConfig();
  const toast = useToast();
  const [selected, setSelected] = useState('gemini');
  const [keys, setKeys] = useState({ gemini: '', openai: '', anthropic: '' });
  const [models, setModels] = useState({ gemini: '', openai: '', anthropic: '' });
  const [show, setShow] = useState(false);
  const [horarios, setHorarios] = useState([]);
  const [novoHorario, setNovoHorario] = useState('12:00');
  const [busy, setBusy] = useState('');
  const initializedRef = useRef(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!config) return;
    if (!initializedRef.current) {
      setSelected(config.aiProvider || 'gemini');
      initializedRef.current = true;
    }
    setModels({
      gemini: config.providers?.gemini?.model || config.geminiModel || '',
      openai: config.providers?.openai?.model || '',
      anthropic: config.providers?.anthropic?.model || '',
    });
    setHorarios(config.monitorHorarios || []);
  }, [config]);

  if (!config) return <div className="page-loading"><Spinner size={28} /></div>;

  const meta = PROVIDER_META.find((p) => p.id === selected) || PROVIDER_META[0];
  const providerCfg = config.providers?.[selected] || {};
  const isActive = config.aiProvider === selected;

  const run = async (name, fn) => {
    setBusy(name);
    try { await fn(); } catch (e) { toast(e.message, { type: 'error' }); } finally { setBusy(''); }
  };

  const saveProvider = (activate = false) => run('ia', async () => {
    const patch = {
      [meta.modelField]: (models[selected] || providerCfg.modeloPadrao || '').trim(),
    };
    const typedKey = (keys[selected] || '').trim();
    if (typedKey) patch[meta.keyField] = typedKey;
    if (activate || (!config.iaDisponivel && typedKey)) patch.aiProvider = selected;
    await api.saveConfig(patch);
    setKeys((prev) => ({ ...prev, [selected]: '' }));
    await reload();
    toast(
      activate
        ? `${meta.title} salvo e definido como provedor de IA ativo.`
        : `Configurações de ${meta.title} salvas.`,
    );
  });

  const activateOnly = (providerId) => run(`act-${providerId}`, async () => {
    const target = PROVIDER_META.find((p) => p.id === providerId);
    await api.saveConfig({ aiProvider: providerId });
    await reload();
    toast(`${target?.title || providerId} agora é o provedor de IA ativo.`);
  });

  const removeKey = () => run('rm', async () => {
    await api.saveConfig({ [meta.keyField]: '' });
    await reload();
    toast(`Chave de ${meta.title} removida da sua conta.`);
  });

  const testar = () => run('test', async () => {
    const r = await api.testarIa(selected);
    toast(`Conexão OK com ${r.providerLabel} (${r.model}).`, { title: 'IA funcionando' });
  });

  const saveHorarios = (list) => run('hor', async () => {
    await api.saveConfig({ monitorHorarios: list });
    await reload();
    toast('Horários de verificação atualizados.');
  });

  const runNow = () => run('mon', async () => {
    const r = await api.runMonitor();
    toast(`${r.verificados} página(s) verificada(s), ${r.alterados} com alteração.`, { type: r.alterados ? 'warning' : 'success' });
    window.dispatchEvent(new Event('jc:notificacoes'));
    window.dispatchEvent(new Event('jc:refresh'));
    reload();
  });

  const importar = (file) => run('imp', async () => {
    const data = JSON.parse(await file.text());
    const r = await api.importBackup(data);
    toast(`${r.importados} concurso(s) importado(s).`);
  });

  const canActivate = providerCfg.disponivel && !isActive;

  return (
    <div className="narrow settings">
      <h1>Configurações</h1>
      <p className="muted">Ajuste os provedores de inteligência artificial, o monitoramento e seus dados.</p>

      <section className="card form-section">
        <header>
          <span className="section-icon"><KeyRound size={18} /></span>
          <div>
            <h2>Inteligência artificial (Gemini, ChatGPT e Claude)</h2>
            <p className="muted small">
              Usada para ler editais, preencher gabaritos (pessoal e oficial) e resumir alterações nas páginas monitoradas.
            </p>
          </div>
          <span className={`status-pill ${config.iaDisponivel ? 'ok' : 'off'}`}>
            {config.iaDisponivel ? <><CheckCircle2 size={14} /> Ativa · {config.aiProviderShortLabel}</> : 'Não configurada'}
          </span>
        </header>

        <div className="form-section-body">
          <div className="ai-provider-grid" role="tablist" aria-label="Provedores de IA">
            {PROVIDER_META.map((p) => {
              const Icon = p.icon;
              const info = config.providers?.[p.id] || {};
              const active = config.aiProvider === p.id && info.disponivel;
              const isSel = selected === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={isSel}
                  className={`provider-card ${p.accent} ${isSel ? 'selected' : ''} ${active ? 'is-active' : ''}`}
                  onClick={() => { setSelected(p.id); setShow(false); }}
                >
                  <div className="provider-card-top">
                    <span className="provider-icon"><Icon size={18} /></span>
                    {active ? (
                      <span className="provider-badge active"><Check size={12} /> Em uso</span>
                    ) : info.disponivel ? (
                      <span className="provider-badge ready">Configurada</span>
                    ) : (
                      <span className="provider-badge empty">Sem chave</span>
                    )}
                  </div>
                  <strong>{p.title}</strong>
                  <span className="muted small">{info.model || p.sub}</span>
                </button>
              );
            })}
          </div>

          <div className="provider-panel grid-form">
            {canActivate && (
              <div className="span-4 provider-activate-bar">
                <span className="small">
                  <strong>{meta.title}</strong> já possui chave configurada, mas o provedor ativo atual é <strong>{config.aiProviderLabel}</strong>.
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => activateOnly(selected)}
                  disabled={busy === `act-${selected}`}
                >
                  {busy === `act-${selected}` ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                  Usar {providerCfg.shortLabel || meta.title} como ativo
                </button>
              </div>
            )}

            <Field
              label={`Chave da API — ${meta.title}`}
              className="span-3"
              hint={providerCfg.chaveMascarada
                ? <>Chave atual: <code>{providerCfg.chaveMascarada}</code> ({providerCfg.chaveOrigem === 'env' ? 'definida nas variáveis do servidor' : 'salva na sua conta'}). Deixe em branco para manter.</>
                : <>Obtenha sua chave em <a href={providerCfg.docsUrl} target="_blank" rel="noreferrer">{providerCfg.docsLabel}</a>. Ela fica salva apenas na sua conta.</>}
            >
              <div className="input-icon right">
                <input
                  type={show ? 'text' : 'password'}
                  value={keys[selected] || ''}
                  onChange={(e) => setKeys((prev) => ({ ...prev, [selected]: e.target.value }))}
                  placeholder={providerCfg.chaveMascarada ? '••••••••••••' : `Cole sua chave (${meta.placeholder})`}
                  autoComplete="off"
                />
                <button type="button" className="icon-btn sm" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar chave' : 'Mostrar chave'}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>

            <Field label="Modelo" hint={`Padrão: ${providerCfg.modeloPadrao || ''}`}>
              <input
                list={`models-${selected}`}
                value={models[selected] || ''}
                onChange={(e) => setModels((prev) => ({ ...prev, [selected]: e.target.value }))}
                placeholder={providerCfg.modeloPadrao}
              />
              <datalist id={`models-${selected}`}>
                {(providerCfg.suggestedModels || []).map((m) => <option key={m} value={m} />)}
              </datalist>
            </Field>

            <div className="span-4 row gap-sm wrap">
              <button className="btn btn-primary" onClick={() => saveProvider(!isActive)} disabled={busy === 'ia'}>
                {busy === 'ia' ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                {isActive ? 'Salvar' : `Salvar e usar ${providerCfg.shortLabel || meta.title}`}
              </button>
              {!isActive && (
                <button className="btn btn-outline" onClick={() => saveProvider(false)} disabled={busy === 'ia'}>
                  Apenas salvar chave
                </button>
              )}
              <button className="btn btn-outline" onClick={testar} disabled={!providerCfg.disponivel || busy === 'test'}>
                {busy === 'test' ? <Loader2 size={16} className="spin" /> : <Zap size={16} />} Testar conexão
              </button>
              {providerCfg.chaveOrigem === 'app' && (
                <button className="btn btn-ghost danger" onClick={removeKey} disabled={busy === 'rm'}>
                  Remover chave
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="card form-section">
        <header>
          <span className="section-icon"><Radar size={18} /></span>
          <div>
            <h2>Monitoramento de páginas</h2>
            <p className="muted small">
              Horários em que as páginas dos concursos são verificadas (padrão: 2x ao dia).
              {config.iaDisponivel && <> Alterações detectadas são resumidas automaticamente usando <strong>{config.aiProviderLabel}</strong>.</>}
            </p>
          </div>
        </header>
        <div className="form-section-body">
          <div className="horarios">
            {horarios.map((h) => (
              <span className="tag tag-lg" key={h}>
                {h}
                <button aria-label={`Remover ${h}`} disabled={horarios.length === 1} onClick={() => { const l = horarios.filter((x) => x !== h); setHorarios(l); saveHorarios(l); }}><X size={14} /></button>
              </span>
            ))}
            <div className="add-time">
              <input type="time" value={novoHorario} onChange={(e) => setNovoHorario(e.target.value)} aria-label="Novo horário" />
              <button className="btn btn-outline btn-sm" onClick={() => { if (!novoHorario || horarios.includes(novoHorario)) return; const l = [...horarios, novoHorario].sort(); setHorarios(l); saveHorarios(l); }}><Plus size={15} /> Adicionar</button>
            </div>
          </div>
          <div className="row gap wrap between mt">
            <span className="muted small">Última rodada: {config.ultimaRodadaMonitor ? fmtDateTime(config.ultimaRodadaMonitor) : 'nunca'}</span>
            <button className="btn btn-outline" onClick={runNow} disabled={busy === 'mon'}>
              <RefreshCw size={16} className={busy === 'mon' ? 'spin' : ''} /> {busy === 'mon' ? 'Verificando todas…' : 'Verificar todas agora'}
            </button>
          </div>
        </div>
      </section>

      <section className="card form-section">
        <header>
          <span className="section-icon"><Database size={18} /></span>
          <div>
            <h2>Seus dados & Conta</h2>
            <p className="muted small">
              Conectado como <strong>{user?.nome} {user?.sobrenome}</strong> ({user?.email}) · Armazenamento: <strong>{config.bancoDados || 'Neon Postgres (Nuvem)'}</strong>.
            </p>
          </div>
          <span className="status-pill ok"><CheckCircle2 size={14} /> Isolamento ativo</span>
        </header>
        <div className="form-section-body row gap-sm wrap">
          <a className="btn btn-outline" href="/api/backup" download><Download size={16} /> Exportar meus concursos (JSON)</a>
          <button className="btn btn-outline" onClick={() => fileRef.current?.click()} disabled={busy === 'imp'}><Upload size={16} /> Importar backup</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = ''; }} />
        </div>
      </section>
    </div>
  );
}
