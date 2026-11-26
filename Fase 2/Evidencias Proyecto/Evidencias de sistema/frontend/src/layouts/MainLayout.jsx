import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation, NavLink, Link, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { useI18n } from '../lib/i18n';
import { isPracticeRoute } from '../lib/practice/practiceLock';
import { HEARTBEAT_MS, newUnread, requestRefresh } from '../lib/liveRefresh';
import { showLiveNotice } from '../components/LiveNotice';
import { REPORTS_EVENT, clearUnseen, markReportReady, pendingReports, unseenReports, unwatchReport } from '../lib/practice/reportWatch';
import { roleIndex, homeFor, ROLE_HOME } from '../data/mockData';
import useTheme from '../hooks/useTheme';
import Logo from '../components/Logo';
import Icon from '../components/Icon';
import { Avatar, Button, cx } from '../components/ui';
import { API_URL, apiFetch, clearSession, getCurrentUser, getToken, saveSession } from '../lib/api';
import { displayEmail } from '../lib/displayEmail';
import { setOrgPalette, setPaletteLocked } from '../lib/palette';

export default function MainLayout() {
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState({ unread: 0, items: [] });
  // Informes que se generaron en segundo plano y el vocero aún no abre (contador de Progreso)
  const [newReports, setNewReports] = useState([]);
  const { isDark, toggleTheme } = useTheme();
  const menuRef = useRef(null);
  const bellRef = useRef(null);

  const navigate = useNavigate();
  const location = useLocation();
  const { d, lang, languages, labels, setLanguage, syncUser, languageLocked, releasePracticeLock } = useI18n();

  // Requiere sesión iniciada; se valida el token con el backend (GET /api/auth/me)
  useEffect(() => {
    const token = getToken();
    const storedUser = getCurrentUser();
    if (!token || !storedUser) {
      clearSession();
      navigate('/login');
      return;
    }
    setUser(storedUser);
    apiFetch('/api/auth/me')
      .then(async ({ user: fresh }) => {
        saveSession(token, fresh);
        // El idioma activo sigue al usuario; si hay una selección explícita pendiente (hecha en el
        // login), se guarda como preferencia y prevalece sobre la anterior.
        const effective = (await syncUser(fresh)) || fresh;
        setUser(effective);
      })
      .catch(() => {
        /* 401 → apiFetch ya redirige al login; sin conexión se mantiene la sesión local */
      });
  }, [navigate]);

  // Latido: mantiene al usuario como "conectado" en las métricas mientras tenga la plataforma abierta
  useEffect(() => {
    const beat = setInterval(() => {
      if (getToken() && !document.hidden) apiFetch('/api/auth/heartbeat', { method: 'POST' }).catch(() => {});
    }, 2 * 60 * 1000);
    return () => clearInterval(beat);
  }, []);

  // Colores de la organización (configuración "Estilo" del administrador del cliente).
  // Los voceros y su administrador ven siempre la paleta de la organización.
  useEffect(() => {
    setOrgPalette(user?.palette);
    setPaletteLocked(['user', 'admin'].includes(user?.role));
  }, [user]);

  // Cierra menús al cambiar de ruta
  useEffect(() => {
    setMenuOpen(false);
    setMobileOpen(false);
  }, [location.pathname]);

  // Bloqueo del idioma durante la práctica: al salir del flujo (preparación → entrevista → análisis
  // → informe) el idioma vuelve a poder cambiarse. Cubre cualquier salida, también el botón «atrás».
  useEffect(() => {
    if (languageLocked && !isPracticeRoute(location.pathname)) releasePracticeLock();
  }, [location.pathname, languageLocked, releasePracticeLock]);

  // Cierra el menú de usuario al hacer clic fuera
  useEffect(() => {
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Consulta las notificaciones del vocero (sin bloquear la interfaz si falla).
  // IMPORTANTE: se declara ANTES del efecto que la usa. La lista de dependencias de un `useEffect`
  // se evalúa durante el render, así que un `const` declarado más abajo todavía estaría en la zona
  // muerta temporal y lanzaría «Cannot access 'loadNotifications' before initialization».
  // Claves de las no leídas ya conocidas: solo se avisa de las que aparecen después.
  const knownUnreadRef = useRef(null);
  const loadNotifications = useCallback(async () => {
    if (!getToken()) return;
    try {
      const data = await apiFetch('/api/notifications');
      const items = data.items || [];
      setNotifications({ unread: data.unread || 0, items });
      const { fresh, keys } = newUnread(items, knownUnreadRef.current);
      knownUnreadRef.current = keys;
      if (fresh.length) {
        const t = dRef.current.mainLayout;
        const latest = fresh[0];
        showLiveNotice({
          id: `review-${latest.sessionId}`,
          icon: 'message',
          title: t.reviewReadyTitle,
          message: t.reviewReadyMessage(latest.theme, latest.reviewer),
          actionLabel: t.notificationOpen,
          closeLabel: t.noticeClose,
          onAction: () => openNotificationRef.current?.(latest),
        });
        requestRefresh();
      }
    } catch {
      /* sin conexión se conserva lo último mostrado */
    }
  }, []);

  // Notificaciones del vocero: avisos de revisiones humanas PUBLICADAS (la campanita). El backend
  // las genera al enviar la revisión; aquí solo se consultan y se marcan como leídas.
  useEffect(() => {
    if (user?.role !== 'user') return undefined;
    // Latido: consulta cada pocos segundos, solo con la pestaña visible.
    loadNotifications();
    const timer = setInterval(() => {
      if (!document.hidden) loadNotifications();
    }, HEARTBEAT_MS);
    const onVisible = () => {
      if (!document.hidden) loadNotifications();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.role, loadNotifications]);

  // Informes en segundo plano: al terminar la entrevista el vocero puede seguir navegando. Mientras
  // haya informes en preparación se consultan cada 5 s; al quedar listos se avisa arriba y Progreso
  // muestra un contador. `pathRef`/`dRef` evitan reiniciar el sondeo en cada navegación.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const dRef = useRef(d);
  dRef.current = d;

  useEffect(() => {
    if (user?.role !== 'user') return undefined;
    const refresh = () => setNewReports(unseenReports(user.id));
    refresh();
    window.addEventListener(REPORTS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(REPORTS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [user?.role, user?.id]);

  useEffect(() => {
    if (user?.role !== 'user') return undefined;
    let busy = false;
    const check = async () => {
      // En «Analizando» la propia pantalla sigue el informe y lo abre al terminar.
      if (busy || document.hidden || pathRef.current.startsWith('/vocero/analizando')) return;
      const pending = pendingReports(user.id);
      if (!pending.length) return;
      busy = true;
      for (const item of pending) {
        try {
          const data = await apiFetch(`/api/sessions/${item.sessionId}`);
          if (data?.session?.report) {
            markReportReady(user.id, item);
            const t = dRef.current.mainLayout;
            showLiveNotice({
              id: `report-${item.sessionId}`,
              icon: 'sparkles',
              title: t.reportReadyTitle,
              message: t.reportReadyMessage(item.theme),
              actionLabel: t.reportReadyOpen,
              closeLabel: t.noticeClose,
              onAction: () => navigate(`/vocero/informe?sesion=${item.sessionId}`),
            });
            requestRefresh();
          } else if (['failed', 'stalled'].includes(data?.evaluation?.state)) {
            unwatchReport(user.id, item.sessionId);
            toast.error(dRef.current.mainLayout.reportFailed, { position: 'top-center', duration: 8000 });
          }
        } catch (error) {
          // La sesión ya no existe (descartada o eliminada): se deja de vigilar.
          if (error?.status === 404) unwatchReport(user.id, item.sessionId);
        }
      }
      busy = false;
    };
    check();
    const timer = setInterval(check, HEARTBEAT_MS);
    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.role, user?.id, navigate]);

  // Mientras haya informes sin ver, la pestaña del navegador lo indica: «(1) VoxReady».
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = newReports.length ? `(${newReports.length}) ${base}` : base;
  }, [newReports.length]);

  // El contador se limpia al entrar a Progreso (todos) o al abrir un informe (solo ese).
  useEffect(() => {
    if (user?.role !== 'user') return;
    if (location.pathname.startsWith('/vocero/progreso')) clearUnseen(user.id);
    else if (location.pathname.startsWith('/vocero/informe')) {
      const opened = new URLSearchParams(location.search).get('sesion');
      if (opened) clearUnseen(user.id, opened);
    }
  }, [location.pathname, location.search, user?.role, user?.id]);

  // Abrir una notificación: se marca como leída y se abre SU informe.
  const openNotificationRef = useRef(null);
  const openNotification = async (item) => {
    setBellOpen(false);
    try {
      await apiFetch('/api/notifications/seen', { method: 'POST', body: { sessionId: item.sessionId } });
    } catch {
      /* el aviso se abrirá igualmente */
    }
    setNotifications((current) => ({
      unread: Math.max(0, current.unread - (item.unread ? 1 : 0)),
      items: current.items.map((entry) => (entry.sessionId === item.sessionId ? { ...entry, unread: false } : entry)),
    }));
    navigate(`/vocero/informe?sesion=${item.sessionId}`);
  };
  openNotificationRef.current = openNotification;

  const markAllRead = async () => {
    try {
      await apiFetch('/api/notifications/seen', { method: 'POST', body: { all: true } });
    } catch {
      /* best-effort */
    }
    setNotifications((current) => ({ unread: 0, items: current.items.map((entry) => ({ ...entry, unread: false })) }));
  };

  const handleLogout = () => {
    // Avisa al backend antes de borrar el token (deja de contarse como conectado)
    const token = getToken();
    if (token) fetch(`${API_URL}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    clearSession();
    navigate('/login');
  };

  if (!user) return null;

  // Cada rol solo puede entrar a su propia sección (Laboratorio queda abierto a todos)
  const area = Object.entries(ROLE_HOME).find(
    ([, base]) => location.pathname === base || location.pathname.startsWith(`${base}/`),
  );
  if (area && area[0] !== user.role) return <Navigate to={homeFor(user.role)} replace />;

  const links = [...(d.nav[user.role] || []), d.nav.lab];
  const inPracticeFlow = ['/vocero/preparar', '/vocero/sesion', '/vocero/analizando', '/vocero/informe'].some((p) =>
    location.pathname.startsWith(p),
  );

  // La entrevista usa toda la altura de la pantalla: menos margen y sin pie de página
  const inSession = location.pathname.startsWith('/vocero/sesion');

  const linkClass = ({ isActive }) =>
    cx(
      'relative inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-[13.5px] font-medium whitespace-nowrap transition-colors',
      isActive ? 'text-ink bg-subtle' : 'text-muted hover:text-ink',
    );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Barra superior */}
      <header className="print:hidden sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto h-16 px-4 md:px-6 flex items-center gap-6">
          <Link to={homeFor(user.role)} className="shrink-0" aria-label={d.mainLayout.homeLabel}>
            <Logo />
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
                {l.label}
                {l.to === '/vocero/progreso' && newReports.length > 0 && (
                  <span
                    className="min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[11px] font-semibold leading-none flex items-center justify-center"
                    aria-label={d.mainLayout.newReports(newReports.length)}
                  >
                    {newReports.length}
                  </span>
                )}
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

            {/* Idioma de la interfaz: preferencia individual del usuario.
                Durante una práctica queda BLOQUEADO (lo fija el idioma de la sesión) y el cambio se
                rechaza también en el proveedor, no solo aquí. */}
            <div className="relative flex items-center">
              <select
                value={lang}
                onChange={(e) => {
                  setLanguage(e.target.value)
                    .then((result) => {
                      if (result?.blocked) toast.error(d.mainLayout.languageLockedToast);
                    })
                    .catch(() => {});
                }}
                disabled={languageLocked}
                title={languageLocked ? d.mainLayout.languageLockedHint : labels[lang]}
                aria-label={languageLocked ? d.mainLayout.languageLocked : 'Idioma / Language'}
                className={cx(
                  'h-9 rounded-lg border border-line bg-surface px-2 text-xs text-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/40',
                  languageLocked && 'pr-7 opacity-70 cursor-not-allowed hover:text-muted',
                )}
              >
                {languages.map((code) => (
                  <option key={code} value={code}>
                    {code.toUpperCase()}
                  </option>
                ))}
              </select>
              {languageLocked && (
                <Icon name="lock" size={12} className="absolute right-2 text-muted pointer-events-none" />
              )}
            </div>

            {/* Campanita: avisos de revisiones humanas PUBLICADAS (solo para el vocero) */}
            {user.role === 'user' && (
              <div className="relative" ref={bellRef}>
                <button
                  type="button"
                  onClick={() => setBellOpen((value) => !value)}
                  title={d.mainLayout.notifications}
                  aria-label={d.mainLayout.notifications}
                  aria-haspopup="menu"
                  aria-expanded={bellOpen}
                  className="relative h-9 w-9 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-subtle transition-colors"
                >
                  <Icon name="bell" size={17} />
                  {notifications.unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-semibold flex items-center justify-center">
                      {notifications.unread}
                    </span>
                  )}
                </button>
                <AnimatePresence>
                  {bellOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.98 }}
                      transition={{ duration: 0.12 }}
                      className="absolute right-0 mt-2 w-80 rounded-xl border border-line bg-surface shadow-lift p-1.5 origin-top-right"
                      role="menu"
                    >
                      <div className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="text-sm font-medium text-ink">{d.mainLayout.notifications}</span>
                        {notifications.unread > 0 && (
                          <button type="button" onClick={markAllRead} className="text-xs text-accent-fg hover:underline">
                            {d.mainLayout.notificationMarkAll}
                          </button>
                        )}
                      </div>
                      <div className="h-px bg-line my-1" />
                      {notifications.items.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-muted">{d.mainLayout.notificationsEmpty}</p>
                      ) : (
                        <div className="max-h-80 overflow-y-auto">
                          {notifications.items.map((item) => (
                            <button
                              key={item.sessionId}
                              type="button"
                              onClick={() => openNotification(item)}
                              className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-subtle transition-colors"
                              role="menuitem"
                            >
                              <div className="flex items-start gap-2">
                                {item.unread && <span className="mt-1.5 h-2 w-2 rounded-full bg-danger shrink-0" />}
                                <div className="min-w-0">
                                  <div className={cx('text-[13px]', item.unread ? 'font-medium text-ink' : 'text-muted')}>
                                    {d.mainLayout.notificationNew}
                                  </div>
                                  <div className="text-xs text-muted truncate mt-0.5">
                                    {[item.theme, d.mainLayout.notificationFrom(item.reviewer)].filter(Boolean).join(' · ')}
                                  </div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

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
                        <div className="text-xs text-muted truncate">{displayEmail(user)}</div>
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
              aria-label={d.mainLayout.menu}
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
                    {l.to === '/vocero/progreso' && newReports.length > 0 && (
                      <span
                        className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-danger text-white text-[11px] font-semibold flex items-center justify-center"
                        aria-label={d.mainLayout.newReports(newReports.length)}
                      >
                        {newReports.length}
                      </span>
                    )}
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
            // exit={{ opacity: 0, y: -0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={cx('mx-auto px-4 md:px-6', inSession ? 'max-w-[1500px] py-4' : 'max-w-6xl py-10 md:py-14')}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className={cx('print:hidden border-t border-line', inSession && 'hidden')}>
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between text-xs text-faint">
          <span>© 2026 VoxReady</span>
          <span className="hidden sm:inline">{d.mainLayout.footerTagline}</span>
        </div>
      </footer>
    </div>
  );
}
