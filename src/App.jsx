import { useCallback, useEffect, useState } from 'react';
import { ConfigCtx } from './lib/configContext.js';
import { LayoutGrid, Plus, Settings, Moon, Sun, Target, LogOut } from 'lucide-react';
import { useRoute, navigate, match } from './lib/router.js';
import { api } from './lib/api.js';
import { ToastProvider, Spinner } from './components/ui.jsx';
import NotificationBell from './components/NotificationBell.jsx';
import LandingPage from './pages/LandingPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import NovoConcurso from './pages/NovoConcurso.jsx';
import ConcursoDetail from './pages/ConcursoDetail.jsx';
import EditarConcurso from './pages/EditarConcurso.jsx';
import Configuracoes from './pages/Configuracoes.jsx';

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('jc-theme')
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('jc-theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export default function App() {
  const route = useRoute();
  const [theme, toggleTheme] = useTheme();
  const [user, setUser] = useState(undefined); // undefined = verificando, null = deslogado
  const [config, setConfig] = useState(null);

  const reload = useCallback(() => {
    if (!user) return;
    api.getConfig().then(setConfig).catch(() => {});
  }, [user]);

  useEffect(() => {
    api.me()
      .then((r) => setUser(r?.user || null))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    const onUnauth = () => {
      setUser(null);
      setConfig(null);
    };
    window.addEventListener('jc:unauthorized', onUnauth);
    return () => window.removeEventListener('jc:unauthorized', onUnauth);
  }, []);

  useEffect(() => {
    if (user) reload();
  }, [user, reload]);

  const handleLogout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    setUser(null);
    setConfig(null);
    navigate('/');
  };

  if (user === undefined) {
    return (
      <div className="page-loading" style={{ minHeight: '100vh' }}>
        <Spinner size={28} label="Carregando plataforma…" />
      </div>
    );
  }

  if (!user) {
    return (
      <ToastProvider>
        <LandingPage
          theme={theme}
          onToggleTheme={toggleTheme}
          onAuthSuccess={(u) => {
            setUser(u);
            navigate('/');
          }}
        />
      </ToastProvider>
    );
  }

  let page;
  let params;
  if (route.path === '/' || route.path === '') page = <Dashboard query={route.query} user={user} />;
  else if (route.path === '/novo') page = <NovoConcurso modo={route.query.modo} />;
  else if (route.path === '/config') page = <Configuracoes user={user} />;
  else if ((params = match('/concurso/:id/editar', route.path))) page = <EditarConcurso id={params.id} />;
  else if ((params = match('/concurso/:id', route.path))) page = <ConcursoDetail id={params.id} tab={route.query.aba} />;
  else page = <Dashboard query={{}} user={user} />;

  const navItem = (to, label, Icon, active) => (
    <a href={`#${to}`} className={`nav-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
      <Icon size={18} /> <span>{label}</span>
    </a>
  );

  const initialsUser = `${(user.nome || '?')[0] || ''}${(user.sobrenome || '')[0] || ''}`.toUpperCase();

  return (
    <ConfigCtx.Provider value={{ config, reload, user }}>
      <ToastProvider>
        <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>
        <header className="topbar">
          <div className="topbar-inner">
            <a href="#/" className="brand" aria-label="Jornada do Concurseiro — início">
              <span className="brand-mark"><Target size={20} strokeWidth={2.5} /></span>
              <span className="brand-text">Jornada <em>do Concurseiro</em></span>
            </a>
            <nav className="nav" aria-label="Principal">
              {navItem('/', 'Concursos', LayoutGrid, route.path === '/' || route.path.startsWith('/concurso'))}
              {navItem('/config', 'Configurações', Settings, route.path === '/config')}
            </nav>
            <div className="topbar-actions">
              <button className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Tema claro' : 'Tema escuro'} title="Alternar tema">
                {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
              </button>
              <NotificationBell />
              <button className="btn btn-primary btn-new" onClick={() => navigate('/novo')}>
                <Plus size={18} /> <span>Novo concurso</span>
              </button>
              <div className="user-pill" title={`${user.nome} ${user.sobrenome || ''} (${user.email})`.trim()}>
                <span className="user-avatar" aria-hidden>{initialsUser}</span>
                <span className="user-name">{user.nome}</span>
                <button className="icon-btn sm" onClick={handleLogout} aria-label="Sair da conta" title="Sair da conta">
                  <LogOut size={16} />
                </button>
              </div>
            </div>
          </div>
        </header>
        <main id="conteudo" className="container">{page}</main>
        <footer className="footer">Jornada do Concurseiro · Organize, acompanhe e conquiste sua vaga.</footer>
      </ToastProvider>
    </ConfigCtx.Provider>
  );
}
