import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';
import { TEST_USERS, roleIndex, homeFor } from '../data/mockData';
import { findUserByEmail, getDirectory, initialsOf, registerLogin } from '../data/directory';
import useTheme from '../hooks/useTheme';
import Logo from '../components/Logo';
import Icon from '../components/Icon';
import { Avatar, Button, Field } from '../components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const d = I.es;

  const handleLogin = (user) => {
    // Respeta suspensiones hechas desde la administración del sistema
    const account = findUserByEmail(user.email);
    const tenant = getDirectory().tenants.find((t) => t.id === account?.tenantId);
    if (account?.status === 'SUSPENDED') return setError('Esta cuenta está suspendida. Contacta a tu administrador.');
    if (tenant?.status === 'SUSPENDED') return setError(`La organización ${tenant.name} está suspendida.`);

    registerLogin(user.email);
    localStorage.setItem('voxready_user', JSON.stringify(user));
    navigate(homeFor(user.role));
  };

  const submitLogin = (e) => {
    e.preventDefault();
    const test = TEST_USERS.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (test) return handleLogin(test);

    // Usuarios creados desde la administración (demo sin contraseña)
    const created = findUserByEmail(email);
    if (created) {
      return handleLogin({ role: created.role, initials: initialsOf(created.name), name: created.name, email: created.email });
    }
    setError(d.login.err);
  };

  return (
    <div className="h-dvh overflow-hidden grid lg:grid-cols-[1.05fr_1fr] bg-canvas">
      {/* Panel de marca */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-[#0E1F2F] text-white p-10">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div className="absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-[#E0662A] opacity-20 blur-[120px]" />

        <Logo tone="inverse" className="relative" />

        <div className="relative max-w-md">
          <h2 className="font-display font-semibold text-[44px] xl:text-[50px] leading-[1.12] tracking-[-0.03em]">{d.login.heroTitle}</h2>
          <p className="text-white/60 text-[15px] leading-relaxed mt-5">{d.login.heroSub}</p>

          <div className="mt-8 grid grid-cols-2 gap-3 max-w-sm">
            {['Expresión', 'Tono de voz', 'Coherencia', 'Empatía'].map((a) => (
              <div key={a} className="flex items-center gap-2 text-[13px] text-white/70">
                <span className="h-1.5 w-1.5 rounded-full bg-[#F08046]" />
                {a}
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-xs text-white/40">© 2026 VoxReady</div>
      </aside>

      {/* Formulario */}
      <section className="relative flex flex-col h-dvh">
        <div className="flex items-center justify-between px-6 py-4 shrink-0">
          <Logo className="lg:invisible" />
          <button
            onClick={toggleTheme}
            title={d.theme}
            aria-label={d.theme}
            className="h-9 w-9 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-subtle transition-colors"
          >
            <Icon name={isDark ? 'sun' : 'moon'} size={17} />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex items-center justify-center px-6 pb-10">
          <div className="w-full max-w-[380px]">
            <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-ink">{d.login.title}</h1>
            <p className="text-sm text-muted mt-2 leading-relaxed">{d.login.sub}</p>

            <form onSubmit={submitLogin} className="mt-6 space-y-3">
              <Field label={d.login.emailL}>
                <input
                  className="input"
                  type="email"
                  placeholder={d.login.emailPh}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  autoComplete="email"
                />
              </Field>
              <Field label={d.login.passL}>
                <input className="input" type="password" placeholder={d.login.passPh} autoComplete="current-password" />
              </Field>

              {error && (
                <p className="flex items-center gap-2 text-[13px] text-danger">
                  <Icon name="alert" size={14} />
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" size="lg">
                {d.login.signIn}
              </Button>
            </form>

            <div className="flex items-center gap-3 my-5 text-xs text-faint">
              <span className="flex-1 h-px bg-line" />
              {d.login.testL}
              <span className="flex-1 h-px bg-line" />
            </div>

            <div className="space-y-1.5">
              {TEST_USERS.map((u) => (
                <button
                  key={u.email}
                  onClick={() => handleLogin(u)}
                  className="group w-full flex items-center gap-3 px-3 py-2 rounded-xl border border-line bg-surface text-left hover:border-line-strong hover:shadow-soft transition-all"
                >
                  <Avatar initials={u.initials} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-ink">{u.name}</span>
                    <span className="block text-xs text-muted truncate">
                      {d.roles[roleIndex(u.role)]} · {u.email}
                    </span>
                  </span>
                  <Icon name="arrowRight" size={16} className="text-faint group-hover:text-ink group-hover:translate-x-0.5 transition-all" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
