import { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation, NavLink, Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import I from '../data/dictionary';
import { roleIndex, homeFor } from '../data/mockData';
import useTheme from '../hooks/useTheme';
import Logo from '../components/Logo';
import Icon from '../components/Icon';
import { Avatar, Button, cx } from '../components/ui';

export default function MainLayout() {
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isDark, toggleTheme } = useTheme();
  const menuRef = useRef(null);

  const navigate = useNavigate();
  const location = useLocation();
  const d = I.es;

  useEffect(() => {
    const storedUser = localStorage.getItem('voxready_user');
    if (!storedUser) navigate('/login');
    else setUser(JSON.parse(storedUser));
  }, [navigate]);

  // Cierra menús al cambiar de ruta
  useEffect(() => {
    setMenuOpen(false);
    setMobileOpen(false);
  }, [location.pathname]);

  // Cierra el menú de usuario al hacer clic fuera
  useEffect(() => {
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('voxready_user');
    navigate('/login');
  };

  if (!user) return null;

  const links = [...(d.nav[user.role] || []), d.nav.lab];
  const inPracticeFlow = ['/vocero/preparar', '/vocero/sesion', '/vocero/analizando', '/vocero/informe'].some((p) =>
    location.pathname.startsWith(p),
  );

  const linkClass = ({ isActive }) =>
    cx(
      'relative inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-[13.5px] font-medium transition-colors',
      isActive ? 'text-ink bg-subtle' : 'text-muted hover:text-ink',
    );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Barra superior */}
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto h-16 px-4 md:px-6 flex items-center gap-6">
          <Link to={homeFor(user.role)} className="shrink-0" aria-label="VoxReady inicio">
            <Logo />
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {user.role === 'user' && !inPracticeFlow && (
              <Button to="/vocero/escenarios" variant="accent" size="sm" icon="mic" className="hidden sm:inline-flex">
                {d.practice}
              </Button>
            )}

            <button
              onClick={toggleTheme}
              title={d.theme}
              aria-label={d.theme}
              className="h-9 w-9 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-subtle transition-colors"
            >
              <Icon name={isDark ? 'sun' : 'moon'} size={17} />
            </button>

            {/* Menú de usuario */}
            <div className="relative hidden md:block" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 h-10 pl-1 pr-2 rounded-full hover:bg-subtle transition-colors"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <Avatar initials={user.initials} size="sm" />
                <Icon name="chevronDown" size={14} className="text-muted" />
              </button>
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 mt-2 w-64 rounded-xl border border-line bg-surface shadow-lift p-1.5 origin-top-right"
                    role="menu"
                  >
                    <div className="flex items-center gap-3 p-3">
                      <Avatar initials={user.initials} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink truncate">{user.name}</div>
                        <div className="text-xs text-muted truncate">{user.email}</div>
                      </div>
                    </div>
                    <div className="px-3 pb-2">
                      <span className="text-[11px] font-medium text-muted bg-subtle rounded-md px-2 py-1">
                        {d.roles[roleIndex(user.role)]}
                      </span>
                    </div>
                    <div className="h-px bg-line my-1" />
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-sm text-muted hover:text-ink hover:bg-subtle transition-colors"
                      role="menuitem"
                    >
                      <Icon name="logout" size={16} />
                      {d.login.logout}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="md:hidden h-9 w-9 rounded-lg flex items-center justify-center text-ink hover:bg-subtle"
              aria-label="Menú"
            >
              <Icon name={mobileOpen ? 'x' : 'menu'} size={20} />
            </button>
          </div>
        </div>

        {/* Menú móvil */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="md:hidden overflow-hidden border-t border-line bg-canvas"
            >
              <div className="px-4 py-4 flex flex-col gap-1">
                <div className="flex items-center gap-3 px-2 pb-3 mb-2 border-b border-line">
                  <Avatar initials={user.initials} />
                  <div>
                    <div className="text-sm font-medium">{user.name}</div>
                    <div className="text-xs text-muted">{d.roles[roleIndex(user.role)]}</div>
                  </div>
                </div>
                {links.map((l) => (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    end={l.end}
                    className={({ isActive }) =>
                      cx('flex items-center gap-3 h-11 px-3 rounded-lg text-sm font-medium', isActive ? 'bg-subtle text-ink' : 'text-muted')
                    }
                  >
                    <Icon name={l.icon} size={17} />
                    {l.label}
                  </NavLink>
                ))}
                {user.role === 'user' && (
                  <Button to="/vocero/escenarios" variant="accent" icon="mic" className="mt-2">
                    {d.practice}
                  </Button>
                )}
                <button onClick={handleLogout} className="flex items-center gap-3 h-11 px-3 rounded-lg text-sm text-muted mt-1">
                  <Icon name="logout" size={17} />
                  {d.login.logout}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Contenido */}
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="max-w-6xl mx-auto px-4 md:px-6 py-10 md:py-14"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="border-t border-line">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between text-xs text-faint">
          <span>© 2026 VoxReady</span>
          <span className="hidden sm:inline">Entrenamiento de voceros con IA</span>
        </div>
      </footer>
    </div>
  );
}
