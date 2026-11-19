import { useState } from 'react';
import {
  Target, Sparkles, Radar, Trophy, ShieldCheck, CheckCircle2, Eye, EyeOff,
  ArrowRight, FileText, Lock, Mail, User, AlertCircle, Loader2, Moon, Sun,
  CalendarCheck, Layers, Check, Phone,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatPhoneInput, checkPasswordRules } from '../lib/format.js';

export default function LandingPage({ onAuthSuccess, theme, onToggleTheme }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [nome, setNome] = useState('');
  const [sobrenome, setSobrenome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const rules = checkPasswordRules(password);
  const score = rules.filter((r) => r.ok).length;
  const allRulesOk = score === rules.length;

  const switchMode = (next) => {
    setMode(next);
    setError('');
  };

  const scrollToAuth = (targetMode) => {
    if (targetMode) switchMode(targetMode);
    document.getElementById('acesso-plataforma')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (mode === 'register') {
      if (!nome.trim()) return setError('Informe o seu nome.');
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return setError('Informe um e-mail válido.');
      }
      if (!allRulesOk) {
        return setError('Sua senha precisa cumprir todos os requisitos de segurança abaixo.');
      }
    } else if (!email.trim() || !password) {
      return setError('Informe seu e-mail e sua senha.');
    }

    setLoading(true);
    try {
      const res = mode === 'register'
        ? await api.register({ nome: nome.trim(), sobrenome: sobrenome.trim(), email: email.trim(), telefone: telefone.trim(), password })
        : await api.login({ email: email.trim(), password });
      onAuthSuccess(res.user);
    } catch (err) {
      setError(err.message || 'Não foi possível concluir a operação.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing-wrap">
      <header className="topbar">
        <div className="topbar-inner">
          <a href="#/" className="brand" aria-label="Jornada do Concurseiro">
            <span className="brand-mark"><Target size={20} strokeWidth={2.5} /></span>
            <span className="brand-text">Jornada <em>do Concurseiro</em></span>
          </a>
          <nav className="nav landing-nav" aria-label="Apresentação">
            <a href="#recursos" className="nav-link" onClick={(e) => { e.preventDefault(); document.getElementById('recursos')?.scrollIntoView({ behavior: 'smooth' }); }}>Recursos</a>
            <a href="#como-funciona" className="nav-link" onClick={(e) => { e.preventDefault(); document.getElementById('como-funciona')?.scrollIntoView({ behavior: 'smooth' }); }}>Como funciona</a>
          </nav>
          <div className="topbar-actions">
            <button className="icon-btn" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Tema claro' : 'Tema escuro'} title="Alternar tema">
              {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button className="btn btn-ghost" onClick={() => scrollToAuth('login')}>Entrar</button>
            <button className="btn btn-primary" onClick={() => scrollToAuth('register')}>
              Criar conta grátis
            </button>
          </div>
        </div>
      </header>

      <main className="landing-main">
        {/* HERO + AUTH CARD */}
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <span className="eyebrow"><Sparkles size={13} /> Plataforma inteligente com IA + Nuvem</span>
            <h1>Domine sua jornada até a aprovação em concursos públicos.</h1>
            <p className="landing-lead">
              Organize todos os certames que você deseja prestar em um espaço 100% pessoal. Envie o PDF do edital para a IA extrair cargos, datas e disciplinas automaticamente, monitore retificações na página da banca e corrija seu gabarito em segundos.
            </p>

            <div className="landing-highlights">
              <div className="lh-item">
                <span className="lh-icon"><Sparkles size={18} /></span>
                <div>
                  <strong>Leitura de Editais e Gabaritos por IA</strong>
                  <span>Extraia dados de PDFs, links, textos ou fotos do seu cartão-resposta.</span>
                </div>
              </div>
              <div className="lh-item">
                <span className="lh-icon"><Radar size={18} /></span>
                <div>
                  <strong>Monitoramento Automático da Banca</strong>
                  <span>Receba alertas de novos documentos, retificações, locais de prova e resultados.</span>
                </div>
              </div>
              <div className="lh-item">
                <span className="lh-icon"><ShieldCheck size={18} /></span>
                <div>
                  <strong>Ambiente Individual na Nuvem (Neon Postgres)</strong>
                  <span>Cada concurseiro possui sua conta protegida e visualiza exclusivamente seus próprios concursos.</span>
                </div>
              </div>
            </div>

            <div className="landing-cta-row">
              <button className="btn btn-primary btn-lg" onClick={() => scrollToAuth('register')}>
                Começar agora gratuitamente <ArrowRight size={18} />
              </button>
              <a href="#recursos" className="btn btn-outline btn-lg" onClick={(e) => { e.preventDefault(); document.getElementById('recursos')?.scrollIntoView({ behavior: 'smooth' }); }}>
                Conhecer funcionalidades
              </a>
            </div>
          </div>

          <div className="auth-card card" id="acesso-plataforma">
            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
                onClick={() => switchMode('login')}
              >
                Entrar na conta
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
                onClick={() => switchMode('register')}
              >
                Criar conta
              </button>
            </div>

            <div className="auth-header">
              <h2>{mode === 'login' ? 'Bem-vindo(a) de volta!' : 'Crie sua conta gratuita'}</h2>
              <p className="muted small">
                {mode === 'login'
                  ? 'Acesse seu painel pessoal de concursos, provas e gabaritos.'
                  : 'Seus concursos, anotações e gabaritos ficam salvos com segurança na sua conta.'}
              </p>
            </div>

            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              {mode === 'register' && (
                <div className="auth-row-2">
                  <label className="field">
                    <span className="field-label">Nome <span className="req">*</span></span>
                    <div className="input-icon">
                      <User size={16} />
                      <input
                        type="text"
                        value={nome}
                        onChange={(e) => setNome(e.target.value)}
                        placeholder="Seu nome"
                        autoComplete="given-name"
                        required
                      />
                    </div>
                  </label>
                  <label className="field">
                    <span className="field-label">Sobrenome <span className="muted">(opcional)</span></span>
                    <input
                      type="text"
                      value={sobrenome}
                      onChange={(e) => setSobrenome(e.target.value)}
                      placeholder="Seu sobrenome"
                      autoComplete="family-name"
                    />
                  </label>
                </div>
              )}

              <label className="field">
                <span className="field-label">E-mail <span className="req">*</span></span>
                <div className="input-icon">
                  <Mail size={16} />
                  <input
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@exemplo.com"
                    autoComplete="email"
                    required
                  />
                </div>
              </label>

              {mode === 'register' && (
                <label className="field">
                  <span className="field-label">Telefone para alertas no Telegram <span className="muted">(opcional)</span></span>
                  <div className="input-icon">
                    <Phone size={16} />
                    <input
                      type="tel"
                      inputMode="tel"
                      value={telefone}
                      onChange={(e) => setTelefone(formatPhoneInput(e.target.value))}
                      placeholder="+55 (11) 99999-9999"
                      autoComplete="tel"
                    />
                  </div>
                </label>
              )}

              <label className="field">
                <span className="field-label">Senha <span className="req">*</span></span>
                <div className="input-icon right">
                  <Lock size={16} className="left-lock" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    className="with-both-icons"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'register' ? 'Crie uma senha forte' : 'Sua senha'}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    required
                  />
                  <button
                    type="button"
                    className="icon-btn sm"
                    onClick={() => setShowPass((s) => !s)}
                    aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              {mode === 'register' && (
                <div className="pwd-policy" aria-live="polite">
                  <div className="pwd-bars" aria-hidden>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span
                        key={n}
                        className={`pwd-bar ${score >= n ? (score <= 2 ? 'weak' : score <= 4 ? 'medium' : 'strong') : ''}`}
                      />
                    ))}
                  </div>
                  <ul className="pwd-rules">
                    {rules.map((r) => (
                      <li key={r.key} className={r.ok ? 'ok' : ''}>
                        {r.ok ? <Check size={13} /> : <span className="pwd-dot" />}
                        <span>{r.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {error && (
                <div className="alert alert-error" role="alert">
                  <AlertCircle size={17} /> <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary btn-lg auth-submit"
                disabled={loading || (mode === 'register' && !allRulesOk)}
              >
                {loading ? <Loader2 size={18} className="spin" /> : null}
                {mode === 'login' ? 'Entrar na plataforma' : 'Criar minha conta'}
                {!loading && <ArrowRight size={17} />}
              </button>
            </form>

            <div className="auth-footer-switch">
              {mode === 'login' ? (
                <span>
                  Ainda não tem conta?{' '}
                  <button type="button" className="link-btn" onClick={() => switchMode('register')}>
                    Cadastre-se gratuitamente
                  </button>
                </span>
              ) : (
                <span>
                  Já possui uma conta?{' '}
                  <button type="button" className="link-btn" onClick={() => switchMode('login')}>
                    Fazer login
                  </button>
                </span>
              )}
            </div>
          </div>
        </section>

        {/* RECURSOS */}
        <section className="landing-section" id="recursos">
          <div className="landing-section-head">
            <span className="eyebrow">Tudo o que você precisa</span>
            <h2>Projetado para quem leva a aprovação a sério</h2>
            <p className="muted">Do lançamento do edital até a conferência do gabarito oficial, sem planilhas confusas.</p>
          </div>

          <div className="landing-features-grid">
            <article className="card lf-card">
              <span className="lf-icon i-primary"><FileText size={22} /></span>
              <h3>Leitura Automática do Edital</h3>
              <p className="muted">
                Envie o PDF do edital (mesmo com dezenas de páginas), informe o link ou cole o texto. A IA identifica órgão, banca, datas, cidades, cargos, salários, benefícios e todas as disciplinas e pesos.
              </p>
            </article>

            <article className="card lf-card">
              <span className="lf-icon i-success"><Layers size={22} /></span>
              <h3>Visão em Cartões Inteligentes</h3>
              <p className="muted">
                Visualize rapidamente inscrições abertas, contagem regressiva para a prova, turno, local, remuneração e barra de progresso do período de inscrição.
              </p>
            </article>

            <article className="card lf-card">
              <span className="lf-icon i-warning"><Radar size={22} /></span>
              <h3>Vigilância da Página da Banca</h3>
              <p className="muted">
                A plataforma monitora a URL oficial do concurso, detecta novos PDFs publicados (retificações, convocações, gabaritos) e envia notificações com resumo por IA.
              </p>
            </article>

            <article className="card lf-card">
              <span className="lf-icon i-info"><Trophy size={22} /></span>
              <h3>Simulador e Leitor de Gabaritos</h3>
              <p className="muted">
                Cadastre suas respostas logo após a prova (digitando ou enviando foto/PDF/TXT para leitura via IA) e compare com o gabarito oficial com cálculo de pesos, mínimos e penalidade estilo Cebraspe.
              </p>
            </article>
          </div>
        </section>

        {/* COMO FUNCIONA */}
        <section className="landing-section" id="como-funciona">
          <div className="landing-section-head">
            <span className="eyebrow">Passo a passo</span>
            <h2>Como funciona na prática</h2>
          </div>
          <div className="welcome-steps">
            {[
              [CheckCircle2, '1. Crie sua conta pessoal', 'Cadastro rápido apenas com nome, e-mail e senha forte. Seus dados ficam isolados e salvos na nuvem.'],
              [Sparkles, '2. Cadastre seus certames', 'Importe o edital com 1 clique usando a IA ou preencha manualmente os concursos que estão no seu radar.'],
              [CalendarCheck, '3. Acompanhe e calcule sua nota', 'Receba avisos de alterações na página da banca, registre suas respostas da prova e veja sua nota detalhada por disciplina.'],
            ].map(([I, t, d]) => (
              <div className="step-card" key={t}>
                <span className="step-icon"><I size={22} /></span>
                <strong>{t}</strong>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        Jornada do Concurseiro · Organize, acompanhe e conquiste sua vaga.
      </footer>
    </div>
  );
}
