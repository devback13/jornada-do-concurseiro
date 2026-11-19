import { useEffect, useRef, useState } from 'react';
import {
  KeyRound, Eye, EyeOff, Radar, Plus, X, Save, Loader2, Zap, Download, Upload,
  Database, CheckCircle2, RefreshCw, Sparkles, Check, Bot, Cpu, User, Mail,
  Phone, Lock, Send, ExternalLink, Link2, ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useConfig } from '../lib/configContext.js';
import { fmtDateTime, formatPhoneInput, toE164Preview, checkPasswordRules } from '../lib/format.js';
import { Field, Spinner, useToast } from '../components/ui.jsx';

const PROVIDER_META = [
  { id: 'gemini', title: 'Google Gemini', sub: 'Gemini 3.8 / 4', keyField: 'geminiApiKey', modelField: 'geminiModel', icon: Sparkles, accent: 'p-gemini', placeholder: 'AIza…' },
  { id: 'openai', title: 'ChatGPT (OpenAI)', sub: 'GPT-6 / GPT-5 / 4o', keyField: 'openaiApiKey', modelField: 'openaiModel', icon: Bot, accent: 'p-openai', placeholder: 'sk-…' },
  { id: 'anthropic', title: 'Claude (Anthropic)', sub: 'Claude 5.5 / 4.5', keyField: 'anthropicApiKey', modelField: 'anthropicModel', icon: Cpu, accent: 'p-anthropic', placeholder: 'sk-ant-…' },
];

export default function Configuracoes({ user, onUserUpdated }) {
  const { config, reload } = useConfig();
  const toast = useToast();

  // Perfil do usuário
  const [nome, setNome] = useState(user?.nome || '');
  const [sobrenome, setSobrenome] = useState(user?.sobrenome || '');
  const [email, setEmail] = useState(user?.email || '');
  const [telefone, setTelefone] = useState(() => formatPhoneInput(user?.telefone || ''));
  const [showPwdForm, setShowPwdForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPwd, setShowNewPwd] = useState(false);

  // IA
  const [selected, setSelected] = useState('gemini');
  const [keys, setKeys] = useState({ gemini: '', openai: '', anthropic: '' });
  const [models, setModels] = useState({ gemini: '', openai: '', anthropic: '' });
  const [show, setShow] = useState(false);

  // Telegram
  const [tgToken, setTgToken] = useState('');
  const [showTgToken, setShowTgToken] = useState(false);
  const [tgChatId, setTgChatId] = useState('');
  const [tgAtivo, setTgAtivo] = useState(true);

  // Monitoramento
  const [horarios, setHorarios] = useState([]);
  const [novoHorario, setNovoHorario] = useState('12:00');
  const [busy, setBusy] = useState('');
  const initializedRef = useRef(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (user) {
      setNome(user.nome || '');
      setSobrenome(user.sobrenome || '');
      setEmail(user.email || '');
      setTelefone(formatPhoneInput(user.telefone || ''));
    }
  }, [user]);

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
    if (config.telegram) {
      setTgChatId(config.telegram.chatId || '');
      setTgAtivo(config.telegram.ativo !== false);
    }
  }, [config]);

  if (!config) return <div className="page-loading"><Spinner size={28} /></div>;

  const meta = PROVIDER_META.find((p) => p.id === selected) || PROVIDER_META[0];
  const providerCfg = config.providers?.[selected] || {};
  const isActive = config.aiProvider === selected;
  const tg = config.telegram || {};
  const e164Phone = toE164Preview(telefone);
  const pwdRules = checkPasswordRules(newPassword);
  const pwdAllOk = pwdRules.every((r) => r.ok);

  const run = async (name, fn) => {
    setBusy(name);
    try { await fn(); } catch (e) { toast(e.message, { type: 'error' }); } finally { setBusy(''); }
  };

  // ---------- Salvar Perfil ----------
  const saveProfile = (e) => {
    e?.preventDefault();
    return run('profile', async () => {
      if (!nome.trim()) throw new Error('Informe o seu nome.');
      if (!email.trim()) throw new Error('Informe o seu e-mail.');
      if (showPwdForm && newPassword && !pwdAllOk) {
        throw new Error('A nova senha precisa atender a todos os critérios de segurança.');
      }
      const payload = {
        nome: nome.trim(),
        sobrenome: sobrenome.trim(),
        email: email.trim(),
        telefone: e164Phone || telefone.trim(),
      };
      if (showPwdForm && newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }
      const r = await api.updateProfile(payload);
      onUserUpdated?.(r.user);
      setCurrentPassword('');
      setNewPassword('');
      setShowPwdForm(false);
      await reload();
      toast('Seus dados cadastrais foram atualizados com sucesso.');
    });
  };

  // ---------- Salvar / Vincular / Testar Telegram ----------
  const saveTelegram = () => run('tg-save', async () => {
    const patch = {
      telegramAtivo: tgAtivo,
      telegramChatId: tgChatId.trim(),
    };
    if (tgToken.trim()) patch.telegramBotToken = tgToken.trim();
    await api.saveConfig(patch);
    setTgToken('');
    await reload();
    toast('Configurações do Telegram salvas.');
  });

  const removeTelegramToken = () => run('tg-rm', async () => {
    await api.saveConfig({ telegramBotToken: '', telegramChatId: '' });
    setTgChatId('');
    await reload();
    toast('Bot do Telegram desconectado.');
  });

  const toggleTelegramAtivo = (checked) => run('tg-toggle', async () => {
    setTgAtivo(checked);
    await api.saveConfig({ telegramAtivo: checked });
    await reload();
    toast(checked ? 'Alertas no Telegram ativados.' : 'Alertas no Telegram pausados.');
  });

  const vincularTelegram = () => run('tg-sync', async () => {
    if (tgToken.trim()) {
      await api.saveConfig({ telegramBotToken: tgToken.trim(), telegramAtivo: tgAtivo });
      setTgToken('');
    }
    const r = await api.vincularTelegram();
    await reload();
    if (r.telegram?.chatId) {
      setTgChatId(r.telegram.chatId);
      toast(`Telegram vinculado com sucesso${r.telegram.chatName ? ` (${r.telegram.chatName})` : ''}!`, { title: 'Vínculo concluído' });
    } else {
      toast(
        r.telegram?.botDeepLink
          ? 'Bot validado! Clique em "Abrir Bot no Telegram", pressione Começar (/start) e depois clique em Testar envio.'
          : 'Envie /start ou seu telefone no chat do bot no Telegram para concluir o vínculo.',
        { type: 'info', duration: 7500 },
      );
    }
  });

  const testarTelegram = () => run('tg-test', async () => {
    if (tgToken.trim() || tgChatId.trim() !== (tg.chatId || '')) {
      const patch = { telegramAtivo: tgAtivo, telegramChatId: tgChatId.trim() };
      if (tgToken.trim()) patch.telegramBotToken = tgToken.trim();
      await api.saveConfig(patch);
      setTgToken('');
    }
    await api.testarTelegram();
    await reload();
    toast('Mensagem de teste enviada para o seu Telegram!', { title: 'Telegram funcionando' });
  });

  // ---------- IA ----------
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

  // ---------- Monitoramento & Dados ----------
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
      <p className="muted">Gerencie seus dados cadastrais, alertas via Telegram, inteligência artificial e monitoramento.</p>

      {/* 1. PERFIL DO USUÁRIO + TELEFONE */}
      <section className="card form-section">
        <header>
          <span className="section-icon"><User size={18} /></span>
          <div>
            <h2>Meus dados cadastrais</h2>
            <p className="muted small">
              Atualize seu nome, e-mail, senha e número de telefone compatível com a API do Telegram para receber alertas.
            </p>
          </div>
          {user?.telefone && (
            <span className="status-pill ok"><Phone size={13} /> {user.telefone}</span>
          )}
        </header>

        <form className="form-section-body grid-form" onSubmit={saveProfile} noValidate>
          <Field label="Nome" required className="span-2">
            <div className="input-icon">
              <User size={16} />
              <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" required />
            </div>
          </Field>

          <Field label="Sobrenome (opcional)" className="span-2">
            <input value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} placeholder="Seu sobrenome" />
          </Field>

          <Field label="E-mail" required className="span-2">
            <div className="input-icon">
              <Mail size={16} />
              <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" required />
            </div>
          </Field>

          <Field
            label="Telefone (padrão internacional Telegram)"
            className="span-2"
            hint={e164Phone
              ? <>Formato compatível com a API do Telegram: <code>{e164Phone}</code></>
              : 'Informe DDI + DDD + número. Ex.: +55 (11) 99999-9999'}
          >
            <div className="input-icon">
              <Phone size={16} />
              <input
                type="tel"
                inputMode="tel"
                value={telefone}
                onChange={(e) => setTelefone(formatPhoneInput(e.target.value))}
                placeholder="+55 (11) 99999-9999"
              />
            </div>
          </Field>

          <div className="span-4">
            <button
              type="button"
              className="link-btn"
              onClick={() => setShowPwdForm((s) => !s)}
              aria-expanded={showPwdForm}
            >
              <Lock size={14} /> Alterar minha senha <ChevronDown size={14} className={showPwdForm ? 'rot' : ''} />
            </button>
          </div>

          {showPwdForm && (
            <>
              <Field label="Senha atual" className="span-2">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Digite sua senha atual"
                  autoComplete="current-password"
                />
              </Field>
              <Field label="Nova senha forte" className="span-2">
                <div className="input-icon right">
                  <input
                    type={showNewPwd ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Crie uma nova senha forte"
                    autoComplete="new-password"
                  />
                  <button type="button" className="icon-btn sm" onClick={() => setShowNewPwd((s) => !s)} aria-label="Mostrar senha">
                    {showNewPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>
              {newPassword && (
                <div className="span-4 pwd-policy">
                  <ul className="pwd-rules">
                    {pwdRules.map((r) => (
                      <li key={r.key} className={r.ok ? 'ok' : ''}>
                        {r.ok ? <Check size={13} /> : <span className="pwd-dot" />}
                        <span>{r.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <div className="span-4 row gap-sm wrap">
            <button type="submit" className="btn btn-primary" disabled={busy === 'profile'}>
              {busy === 'profile' ? <Loader2 size={16} className="spin" /> : <Save size={16} />} Salvar dados cadastrais
            </button>
          </div>
        </form>
      </section>

      {/* 2. INTEGRAÇÃO TELEGRAM BOT */}
      <section className="card form-section">
        <header>
          <span className="section-icon tg-icon"><Send size={18} /></span>
          <div>
            <h2>Notificações no Telegram (Bot API)</h2>
            <p className="muted small">
              Além do sininho dentro da aplicação, receba alertas imediatos no seu Telegram sempre que o monitoramento detectar novidades.
            </p>
          </div>
          <span className={`status-pill ${tg.vinculado && tg.ativo ? 'ok' : 'off'}`}>
            {tg.vinculado && tg.ativo
              ? <><CheckCircle2 size={14} /> Conectado{tg.botUsername ? ` · @${tg.botUsername}` : ''}</>
              : tg.botConfigurado
                ? 'Aguardando vínculo'
                : 'Não configurado'}
          </span>
        </header>

        <div className="form-section-body grid-form">
          <label className="switch span-4">
            <input
              type="checkbox"
              checked={tgAtivo}
              onChange={(e) => toggleTelegramAtivo(e.target.checked)}
              disabled={busy === 'tg-toggle'}
            />
            <span className="switch-ui" />
            <span>
              <strong>Disparar notificações do monitoramento para o meu Telegram</strong>{' '}
              <span className="muted small">
                {user?.telefone ? `(vinculado ao número ${user.telefone})` : '(cadastre seu telefone acima para vincular)'}
              </span>
            </span>
          </label>

          <Field
            label="Token do Bot do Telegram (@BotFather)"
            className="span-3"
            hint={tg.tokenMascarado
              ? <>Token atual: <code>{tg.tokenMascarado}</code> ({tg.tokenOrigem === 'env' ? 'configurado no servidor' : 'salvo na sua conta'}{tg.botUsername ? ` · @${tg.botUsername}` : ''}). Deixe em branco para manter.</>
              : <>No Telegram, fale com <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>, envie <code>/newbot</code> e cole aqui o token gerado (ex.: <code>123456:ABC-DEF...</code>).</>}
          >
            <div className="input-icon right">
              <input
                type={showTgToken ? 'text' : 'password'}
                value={tgToken}
                onChange={(e) => setTgToken(e.target.value)}
                placeholder={tg.tokenMascarado ? '••••••••••••' : '123456789:AAH...'}
                autoComplete="off"
              />
              <button type="button" className="icon-btn sm" onClick={() => setShowTgToken((s) => !s)} aria-label="Mostrar token">
                {showTgToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>

          <Field
            label="Chat ID (automático)"
            hint={tg.chatName ? `Vinculado a: ${tg.chatName}` : 'Detectado automaticamente ao vincular'}
          >
            <input
              value={tgChatId}
              onChange={(e) => setTgChatId(e.target.value)}
              placeholder="Ex.: 987654321"
            />
          </Field>

          <div className="span-4 tg-steps">
            <strong>Como vincular seu número de telefone ao Bot em 2 passos:</strong>
            <ol>
              <li>
                Salve seu <strong>Telefone</strong> em <em>Meus dados cadastrais</em> acima e informe o <strong>Token do Bot</strong>.
              </li>
              <li>
                {tg.botDeepLink ? (
                  <>
                    Clique em <a href={tg.botDeepLink} target="_blank" rel="noreferrer"><strong>Abrir @{tg.botUsername} no Telegram</strong></a> e aperte <strong>Começar (/start)</strong> (ou envie seu número <code>{user?.telefone || '+55...'}</code> para o bot), depois clique em <strong>Vincular telefone / Chat</strong>.
                  </>
                ) : (
                  <>
                    Abra seu bot no Telegram, clique em <strong>Começar (/start)</strong> ou envie seu telefone <code>{user?.telefone || '+55...'}</code> no chat do bot e clique em <strong>Vincular telefone / Chat</strong>.
                  </>
                )}
              </li>
            </ol>
          </div>

          <div className="span-4 row gap-sm wrap">
            <button type="button" className="btn btn-primary" onClick={saveTelegram} disabled={busy === 'tg-save'}>
              {busy === 'tg-save' ? <Loader2 size={16} className="spin" /> : <Save size={16} />} Salvar Telegram
            </button>
            {tg.botDeepLink && (
              <a className="btn btn-outline" href={tg.botDeepLink} target="_blank" rel="noreferrer">
                <ExternalLink size={16} /> Abrir @{tg.botUsername}
              </a>
            )}
            <button
              type="button"
              className="btn btn-outline"
              onClick={vincularTelegram}
              disabled={(!tg.botConfigurado && !tgToken.trim()) || busy === 'tg-sync'}
            >
              {busy === 'tg-sync' ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />} Vincular telefone / Chat
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={testarTelegram}
              disabled={(!tg.botConfigurado && !tgToken.trim()) || busy === 'tg-test'}
            >
              {busy === 'tg-test' ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Enviar mensagem de teste
            </button>
            {tg.tokenOrigem === 'app' && (
              <button type="button" className="btn btn-ghost danger" onClick={removeTelegramToken} disabled={busy === 'tg-rm'}>
                Desconectar Bot
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 3. INTELIGÊNCIA ARTIFICIAL */}
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

      {/* 4. MONITORAMENTO */}
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

      {/* 5. BACKUP & BANCO */}
      <section className="card form-section">
        <header>
          <span className="section-icon"><Database size={18} /></span>
          <div>
            <h2>Seus dados & Backup</h2>
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
