import { useEffect, useRef, useState } from 'react';
import { KeyRound, Eye, EyeOff, Radar, Plus, X, Save, Loader2, Zap, Download, Upload, Database, CheckCircle2, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useConfig } from '../lib/configContext.js';
import { fmtDateTime } from '../lib/format.js';
import { Field, Spinner, useToast } from '../components/ui.jsx';

export default function Configuracoes({ user }) {
  const { config, reload } = useConfig();
  const toast = useToast();
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [model, setModel] = useState('');
  const [horarios, setHorarios] = useState([]);
  const [novoHorario, setNovoHorario] = useState('12:00');
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (config) { setModel(config.geminiModel); setHorarios(config.monitorHorarios); }
  }, [config]);

  if (!config) return <div className="page-loading"><Spinner size={28} /></div>;

  const run = async (name, fn) => {
    setBusy(name);
    try { await fn(); } catch (e) { toast(e.message, { type: 'error' }); } finally { setBusy(''); }
  };

  const saveIa = () => run('ia', async () => {
    const patch = { geminiModel: model || config.modeloPadrao };
    if (key.trim()) patch.geminiApiKey = key.trim();
    await api.saveConfig(patch);
    setKey('');
    await reload();
    toast('Configurações de IA salvas.');
  });

  const removeKey = () => run('rm', async () => {
    await api.saveConfig({ geminiApiKey: '' });
    await reload();
    toast('Chave removida do aplicativo.');
  });

  const testar = () => run('test', async () => {
    const r = await api.testarIa();
    toast(`Conexão OK com ${r.model}.`, { title: 'IA funcionando' });
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

  return (
    <div className="narrow settings">
      <h1>Configurações</h1>
      <p className="muted">Ajuste a inteligência artificial, o monitoramento e seus dados.</p>

      <section className="card form-section">
        <header>
          <span className="section-icon"><KeyRound size={18} /></span>
          <div>
            <h2>Inteligência artificial (Gemini)</h2>
            <p className="muted small">Usada para ler editais e resumir alterações nas páginas monitoradas.</p>
          </div>
          <span className={`status-pill ${config.iaDisponivel ? 'ok' : 'off'}`}>{config.iaDisponivel ? <><CheckCircle2 size={14} /> Ativa</> : 'Não configurada'}</span>
        </header>
        <div className="form-section-body grid-form">
          <Field label="Chave da API Gemini" className="span-3"
            hint={config.chaveMascarada
              ? <>Chave atual: <code>{config.chaveMascarada}</code> ({config.chaveOrigem === 'env' ? 'definida no arquivo .env' : 'salva no aplicativo'}). Deixe em branco para manter.</>
              : <>Gere gratuitamente em <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>. Ela fica salva apenas neste computador.</>}>
            <div className="input-icon right">
              <input type={show ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)} placeholder={config.chaveMascarada ? '••••••••••••' : 'Cole sua chave aqui'} autoComplete="off" />
              <button type="button" className="icon-btn sm" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar chave' : 'Mostrar chave'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
          </Field>
          <Field label="Modelo" hint={`Padrão: ${config.modeloPadrao}`}>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={config.modeloPadrao} />
          </Field>
          <div className="span-4 row gap-sm wrap">
            <button className="btn btn-primary" onClick={saveIa} disabled={busy === 'ia'}>{busy === 'ia' ? <Loader2 size={16} className="spin" /> : <Save size={16} />} Salvar</button>
            <button className="btn btn-outline" onClick={testar} disabled={!config.iaDisponivel || busy === 'test'}>{busy === 'test' ? <Loader2 size={16} className="spin" /> : <Zap size={16} />} Testar conexão</button>
            {config.chaveOrigem === 'app' && <button className="btn btn-ghost danger" onClick={removeKey} disabled={busy === 'rm'}>Remover chave</button>}
          </div>
        </div>
      </section>

      <section className="card form-section">
        <header>
          <span className="section-icon"><Radar size={18} /></span>
          <div>
            <h2>Monitoramento de páginas</h2>
            <p className="muted small">Horários em que as páginas dos concursos são verificadas (padrão: 2x ao dia). O aplicativo precisa estar em execução.</p>
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
