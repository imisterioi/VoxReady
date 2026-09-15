import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion'; // <-- NUEVOS IMPORTS
import I from '../data/dictionary';

export default function MainLayout() {
  const [user, setUser] = useState(null);
  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem('voxready_theme') === 'dark';
  });

  const navigate = useNavigate();
  const location = useLocation();
  const d = I.es;

  useEffect(() => {
    const storedUser = localStorage.getItem('voxready_user');
    if (!storedUser) navigate('/login');
    else setUser(JSON.parse(storedUser));
  }, [navigate]);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
      localStorage.setItem('voxready_theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
      localStorage.setItem('voxready_theme', 'light');
    }
  }, [isDark]);

  const handleLogout = () => {
    localStorage.removeItem('voxready_user');
    navigate('/login');
  };

  const toggleTheme = () => setIsDark(!isDark);

  if (!user) return null;

  const roleIndex = user.role === 'user' ? 0 : user.role === 'admin' ? 1 : 2;

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg)] text-[var(--ink)] transition-colors duration-200">
      
      {/* Topbar */}
      <header className="sticky top-0 z-30 flex items-center h-14 px-4 bg-[var(--topbar)] border-b border-[var(--line)] transition-colors duration-200">
        <span className="text-sm text-[var(--muted)]">VoxReady — Prototipo React</span>
        
        <div className="ml-auto flex items-center gap-4">
          <select className="h-8 border border-[var(--line)] rounded-md bg-[var(--panel)] text-[var(--ink)] text-xs px-2 focus:outline-none transition-colors duration-200">
            <option value="es">Español</option>
          </select>
          
          <button onClick={toggleTheme} title={d.theme} className="h-8 w-8 border border-[var(--line)] rounded-md flex items-center justify-center hover:bg-[var(--soft)] transition-colors text-sm">
            {isDark ? '☀️' : '🌙'}
          </button>
          
          <div className="flex items-center gap-3 ml-2 pl-4 border-l border-[var(--line)]">
            <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-white text-xs font-bold flex items-center justify-center shrink-0">
              {user.initials}
            </div>
            <div className="flex flex-col leading-tight hidden md:flex">
              <span className="text-xs font-bold text-[var(--ink)]">{user.name}</span>
              <span className="text-[10px] text-[var(--muted)]">{d.roles[roleIndex]}</span>
            </div>
            <button onClick={handleLogout} className="ml-2 h-8 px-3 border border-[var(--line2)] rounded-md bg-[var(--panel)] text-[var(--ink)] text-xs hover:bg-[var(--soft)] transition-colors flex items-center gap-2">
              ⎋ <span className="hidden sm:inline">{d.login.logout}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        
        {/* Sidebar */}
        <nav className="w-64 bg-[var(--sidebar)] border-r border-[var(--line)] p-4 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto hidden md:block transition-colors duration-200">
          <div className="border-b border-[var(--line)] pb-3 mb-3">
            <h1 className="font-bold text-lg flex items-center gap-2">
              <img src="/VoxReady_logo.png" alt="VoxReady" className="h-6" onError={(e) => e.target.style.display='none'} />
            </h1>
            <p className="text-xs text-[var(--muted)] mt-1">React v1.0</p>
          </div>
          
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-bold mb-2 px-2 mt-4">
            {d.roles[roleIndex]}
          </div>
          
          {/* Menú del Vocero */}
          {user.role === 'user' && (
            <div className="flex flex-col gap-1">
              <Link to="/vocero" className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${location.pathname === '/vocero' ? 'text-[var(--accent)] bg-[var(--accentsoft)] font-semibold border-l-4 border-[var(--accent)]' : 'text-[var(--ink)] hover:bg-[var(--soft)] border-l-4 border-transparent'}`}>
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${location.pathname === '/vocero' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--barfill)] text-[var(--muted)]'}`}>1</span>
                {d.nav[0]}
              </Link>
              <Link to="/vocero/escenarios" className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${location.pathname === '/vocero/escenarios' ? 'text-[var(--accent)] bg-[var(--accentsoft)] font-semibold border-l-4 border-[var(--accent)]' : 'text-[var(--ink)] hover:bg-[var(--soft)] border-l-4 border-transparent'}`}>
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${location.pathname === '/vocero/escenarios' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--barfill)] text-[var(--muted)]'}`}>2</span>
                {d.nav[1]}
              </Link>
              <Link to="/vocero/preparar" className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${location.pathname.includes('/vocero/preparar') ? 'text-[var(--accent)] bg-[var(--accentsoft)] font-semibold border-l-4 border-[var(--accent)]' : 'text-[var(--ink)] hover:bg-[var(--soft)] border-l-4 border-transparent'}`}>
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${location.pathname.includes('/vocero/preparar') ? 'bg-[var(--accent)] text-white' : 'bg-[var(--barfill)] text-[var(--muted)]'}`}>3</span>
                {d.nav[2]}
              </Link>
              <Link to="/vocero/sesion" className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${location.pathname.includes('/vocero/sesion') ? 'text-[var(--accent)] bg-[var(--accentsoft)] font-semibold border-l-4 border-[var(--accent)]' : 'text-[var(--ink)] hover:bg-[var(--soft)] border-l-4 border-transparent'}`}>
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${location.pathname.includes('/vocero/sesion') ? 'bg-[var(--accent)] text-white' : 'bg-[var(--barfill)] text-[var(--muted)]'}`}>4</span>
                {d.nav[3]}
              </Link>
              <Link to="/vocero/analizando" className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${location.pathname.includes('/vocero/analizando') ? 'text-[var(--accent)] bg-[var(--accentsoft)] font-semibold border-l-4 border-[var(--accent)]' : 'text-[var(--ink)] hover:bg-[var(--soft)] border-l-4 border-transparent'}`}>
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${location.pathname.includes('/vocero/analizando') ? 'bg-[var(--accent)] text-white' : 'bg-[var(--barfill)] text-[var(--muted)]'}`}>5</span>
                {d.nav[4]}
              </Link>
              <Link to="/vocero/informe" className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${location.pathname.includes('/vocero/informe') ? 'text-[var(--accent)] bg-[var(--accentsoft)] font-semibold border-l-4 border-[var(--accent)]' : 'text-[var(--ink)] hover:bg-[var(--soft)] border-l-4 border-transparent'}`}>
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${location.pathname.includes('/vocero/informe') ? 'bg-[var(--accent)] text-white' : 'bg-[var(--barfill)] text-[var(--muted)]'}`}>6</span>
                {d.nav[5]}
              </Link>
              <Link to="/vocero/progreso" className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${location.pathname.includes('/vocero/progreso') ? 'text-[var(--accent)] bg-[var(--accentsoft)] font-semibold border-l-4 border-[var(--accent)]' : 'text-[var(--ink)] hover:bg-[var(--soft)] border-l-4 border-transparent'}`}>
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${location.pathname.includes('/vocero/progreso') ? 'bg-[var(--accent)] text-white' : 'bg-[var(--barfill)] text-[var(--muted)]'}`}>7</span>
                {d.nav[6]}
              </Link>
            </div>
          )}

          {/* Menú del Admin */}
          {user.role === 'admin' && (
            <div className="flex flex-col gap-1">
              <Link to="/admin" className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${location.pathname === '/admin' ? 'text-[var(--accent)] bg-[var(--accentsoft)] font-semibold border-l-4 border-[var(--accent)]' : 'text-[var(--ink)] hover:bg-[var(--soft)] border-l-4 border-transparent'}`}>
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${location.pathname === '/admin' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--barfill)] text-[var(--muted)]'}`}>1</span>
                {d.nav[7]}
              </Link>
              <Link to="/admin/tema" className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${location.pathname.includes('/admin/tema') ? 'text-[var(--accent)] bg-[var(--accentsoft)] font-semibold border-l-4 border-[var(--accent)]' : 'text-[var(--ink)] hover:bg-[var(--soft)] border-l-4 border-transparent'}`}>
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${location.pathname.includes('/admin/tema') ? 'bg-[var(--accent)] text-white' : 'bg-[var(--barfill)] text-[var(--muted)]'}`}>2</span>
                {d.nav[8]}
              </Link>
              <Link to="/admin/retencion" className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${location.pathname.includes('/admin/retencion') ? 'text-[var(--accent)] bg-[var(--accentsoft)] font-semibold border-l-4 border-[var(--accent)]' : 'text-[var(--ink)] hover:bg-[var(--soft)] border-l-4 border-transparent'}`}>
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${location.pathname.includes('/admin/retencion') ? 'bg-[var(--accent)] text-white' : 'bg-[var(--barfill)] text-[var(--muted)]'}`}>3</span>
                {d.nav[9]}
              </Link>
            </div>
          )}

          {/* Menú del Maestro */}
          {user.role === 'master' && (
            <div className="flex flex-col gap-1">
              <Link to="/maestro" className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${location.pathname === '/maestro' ? 'text-[var(--accent)] bg-[var(--accentsoft)] font-semibold border-l-4 border-[var(--accent)]' : 'text-[var(--ink)] hover:bg-[var(--soft)] border-l-4 border-transparent'}`}>
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${location.pathname === '/maestro' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--barfill)] text-[var(--muted)]'}`}>1</span>
                {d.nav[10]}
              </Link>
              <Link to="/maestro/rubrica" className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${location.pathname.includes('/maestro/rubrica') ? 'text-[var(--accent)] bg-[var(--accentsoft)] font-semibold border-l-4 border-[var(--accent)]' : 'text-[var(--ink)] hover:bg-[var(--soft)] border-l-4 border-transparent'}`}>
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${location.pathname.includes('/maestro/rubrica') ? 'bg-[var(--accent)] text-white' : 'bg-[var(--barfill)] text-[var(--muted)]'}`}>2</span>
                {d.nav[11]}
              </Link>
              <Link to="/maestro/etiquetado" className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${location.pathname.includes('/maestro/etiquetado') ? 'text-[var(--accent)] bg-[var(--accentsoft)] font-semibold border-l-4 border-[var(--accent)]' : 'text-[var(--ink)] hover:bg-[var(--soft)] border-l-4 border-transparent'}`}>
                <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${location.pathname.includes('/maestro/etiquetado') ? 'bg-[var(--accent)] text-white' : 'bg-[var(--barfill)] text-[var(--muted)]'}`}>3</span>
                {d.nav[12]}
              </Link>
            </div>
          )}
        </nav>

        {/* CONTENIDO PRINCIPAL ANIMADO CON FRAMER MOTION */}
        <main className="flex-1 p-6 md:p-8 overflow-x-hidden relative h-[calc(100vh-56px)] overflow-y-auto">
          {/* AnimatePresence permite animar componentes que se desmontan del DOM */}
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 15 }}    // Estado inicial: invisible y ligeramente desplazado hacia abajo
              animate={{ opacity: 1, y: 0 }}     // Estado final: visible y en su posición original
              exit={{ opacity: 0, y: -15 }}      // Estado de salida: invisible y se desplaza hacia arriba
              transition={{ duration: 0.25, ease: "easeOut" }} // Duración de la animación (0.25s)
              className="h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
        
      </div>
    </div>
  );
}