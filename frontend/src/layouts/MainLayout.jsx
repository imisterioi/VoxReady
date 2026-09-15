import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import I from '../data/dictionary';

export default function MainLayout() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const d = I.es;

  // Verificar si hay sesión al cargar el layout
  useEffect(() => {
    const storedUser = localStorage.getItem('voxready_user');
    if (!storedUser) {
      navigate('/login');
    } else {
      setUser(JSON.parse(storedUser));
    }
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('voxready_user');
    navigate('/login');
  };

  // Si no hay usuario aún (está cargando o redirigiendo), no renderizamos nada para evitar parpadeos
  if (!user) return null;

  // Determinar el índice del rol para los textos
  const roleIndex = user.role === 'user' ? 0 : user.role === 'admin' ? 1 : 2;

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      
      {/* Topbar */}
      <header className="sticky top-0 z-30 flex items-center h-14 px-4 bg-[var(--topbar)] border-b border-[var(--line)]">
        <span className="text-sm text-[var(--muted)]">VoxReady — Prototipo React</span>
        
        <div className="ml-auto flex items-center gap-4">
          {/* <select className="h-8 border border-[var(--line)] rounded-md bg-[var(--panel)] text-xs px-2 focus:outline-none">
            <option value="es">Español</option>
          </select> */}
          <button className="h-8 w-8 border border-[var(--line)] rounded-md flex items-center justify-center hover:bg-[var(--soft)] transition-colors">
            🌙
          </button>
          
          {/* Ficha del usuario (User Chip) */}
          <div className="flex items-center gap-3 ml-2 pl-4 border-l border-[var(--line)]">
            <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-white text-xs font-bold flex items-center justify-center shrink-0">
              {user.initials}
            </div>
            <div className="flex flex-col leading-tight hidden md:flex">
              <span className="text-xs font-bold text-[var(--ink)]">{user.name}</span>
              <span className="text-[10px] text-[var(--muted)]">{d.roles[roleIndex]}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="ml-2 h-8 px-3 border border-[var(--line2)] rounded-md bg-[var(--panel)] text-[var(--ink)] text-xs hover:bg-[var(--soft)] transition-colors flex items-center gap-2"
            >
              ⎋ <span className="hidden sm:inline">{d.login.logout}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        
        {/* Sidebar */}
        <nav className="w-64 bg-[var(--sidebar)] border-r border-[var(--line)] p-4 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto hidden md:block">
          <div className="border-b border-[var(--line)] pb-3 mb-3">
            <h1 className="font-bold text-lg flex items-center gap-2">
              <img src="/VoxReady_logo.png" alt="VoxReady" className="h-6" onError={(e) => e.target.style.display='none'} />
            </h1>
            <p className="text-xs text-[var(--muted)] mt-1">React v1.0</p>
          </div>
          
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-bold mb-2 px-2 mt-4">
            {d.roles[roleIndex]}
          </div>
          
          {/* Navegación activa dinámica */}
          <Link 
            to={`/${user.role === 'user' ? 'vocero' : user.role === 'admin' ? 'admin' : 'maestro'}`}
            className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--accent)] bg-[var(--accentsoft)] border-l-4 border-[var(--accent)] font-semibold cursor-pointer transition-colors"
          >
            <span className="w-5 h-5 rounded-full bg-[var(--accent)] text-white text-[10px] flex items-center justify-center shrink-0">1</span>
            {user.role === 'user' ? d.nav[0] : user.role === 'admin' ? d.nav[7] : d.nav[10]}
          </Link>
        </nav>

        {/* Contenido principal */}
        <main className="flex-1 p-6 md:p-8 overflow-x-hidden">
          <Outlet />
        </main>
        
      </div>
    </div>
  );
}