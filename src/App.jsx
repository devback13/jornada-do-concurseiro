import { useCallback, useEffect, useState } from 'react';
import { ConfigCtx } from './lib/configContext.js';
import { LayoutGrid, Plus, Settings, Moon, Sun, Target } from 'lucide-react';
import { useRoute, navigate, match } from './lib/router.js';
import { api } from './lib/api.js';
import { ToastProvider } from './components/ui.jsx';
import NotificationBell from './components/NotificationBell.jsx';
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
  const [config, setConfig] = useState(null);
  const reload = useCallback(() => api.getConfig().then(setConfig).catch(() => {}), []);
  useEffect(() => { reload(); }, [reload]);

  let page;
  let params;
  if (route.path === '/' || route.path === '') page = <Dashboard query={route.query} />;
  else if (route.path === '/novo') page = <NovoConcurso modo={route.query.modo} />;
  else if (route.path === '/config') page = <Configuracoes />;
  else if ((params = match('/concurso/:id/editar', route.path))) page = <EditarConcurso id={params.id} />;
  else if ((params = match('/concurso/:id', route.path))) page = <ConcursoDetail id={params.id} tab={route.query.aba} />;
  else page = <Dashboard query={{}} />;

  const navItem = (to, label, Icon, active) => (
    <a href={`#${to}`} className={`nav-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
      <Icon size={18} /> <span>{label}</span>
    </a>
  );

  return (
    <ConfigCtx.Provider value={{ config, reload }}>
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
            </div>
          </div>
        </header>
        <main id="conteudo" className="container">{page}</main>
        <footer className="footer">Jornada do Concurseiro · Organize, acompanhe e conquiste sua vaga.</footer>
      </ToastProvider>
    </ConfigCtx.Provider>
  );
}
