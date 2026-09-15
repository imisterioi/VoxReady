import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import I from '../data/dictionary';
import { TEST_USERS } from '../data/mockData';

export default function Login() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const d = I.es;

  // Leer el tema al cargar el Login para mantener la consistencia
  useEffect(() => {
    const isDark = localStorage.getItem('voxready_theme') === 'dark';
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
    }
  }, []);

  const handleLogin = (user) => {
    localStorage.setItem('voxready_user', JSON.stringify(user));
    if (user.role === 'user') navigate('/vocero');
    if (user.role === 'admin') navigate('/admin');
    if (user.role === 'master') navigate('/maestro');
  };

  const submitLogin = () => {
    const user = TEST_USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (user) {
      handleLogin(user);
    } else {
      setError(d.login.err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-[var(--bg)] text-[var(--ink)] transition-colors duration-200">
      <div className="w-full max-w-md bg-[var(--panel)] border border-[var(--line)] rounded-2xl p-8 shadow-lg transition-colors duration-200">
        
        <div className="flex justify-center mb-5">
          <span className="bg-white rounded-lg p-2 shadow-sm border border-gray-100">
            <img src="/VoxReady_logo.png" alt="VoxReady" className="h-10 block" />
          </span>
        </div>
        
        <h1 className="text-xl font-semibold text-center mb-1 text-[var(--ink)]">{d.login.title}</h1>
        <p className="text-sm text-[var(--muted)] text-center mb-6">{d.login.sub}</p>

        <div className="mb-4">
          <label className="block text-[11px] text-[var(--muted)] uppercase tracking-wider font-semibold mb-1">
            {d.login.emailL}
          </label>
          <input
            className="w-full h-10 border border-[var(--line)] rounded-lg bg-[var(--panel)] text-[var(--ink)] text-[13px] px-3 focus:outline-none focus:border-[var(--accent)] transition-colors"
            type="email"
            placeholder={d.login.emailPh}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitLogin()}
          />
        </div>

        <div className="mb-4">
          <label className="block text-[11px] text-[var(--muted)] uppercase tracking-wider font-semibold mb-1">
            {d.login.passL}
          </label>
          <input
            className="w-full h-10 border border-[var(--line)] rounded-lg bg-[var(--panel)] text-[var(--ink)] text-[13px] px-3 focus:outline-none focus:border-[var(--accent)] transition-colors"
            type="password"
            placeholder={d.login.passPh}
          />
        </div>

        <button
          className="w-full h-10 border-none rounded-lg bg-[var(--accent2)] text-white text-sm font-semibold cursor-pointer mt-2 hover:brightness-105 transition-all"
          onClick={submitLogin}
        >
          {d.login.signIn}
        </button>

        <p className="text-xs text-red-500 mt-2 min-h-[16px] text-center">{error}</p>

        <div className="flex items-center gap-2 my-5 text-[var(--muted)] text-[11px] uppercase tracking-wider before:flex-1 before:h-px before:bg-[var(--line)] after:flex-1 after:h-px after:bg-[var(--line)]">
          {d.login.testL}
        </div>

        {TEST_USERS.map((u, i) => (
          <button
            key={i}
            onClick={() => handleLogin(u)}
            className="flex items-center gap-3 w-full text-left border border-[var(--line)] rounded-xl bg-[var(--panel)] p-3 cursor-pointer mb-2 hover:border-[var(--accent)] hover:bg-[var(--accentsoft)] transition-colors"
          >
            <span className="w-8 h-8 rounded-full bg-[var(--accent)] text-white text-xs font-semibold flex items-center justify-center shrink-0">
              {u.initials}
            </span>
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="text-[13px] font-semibold text-[var(--ink)]">{u.name}</span>
              <span className="text-[11px] text-[var(--muted)]">
                {d.roles[u.role === 'user' ? 0 : u.role === 'admin' ? 1 : 2]} · {u.email}
              </span>
            </span>
            <span className="text-lg text-[var(--muted)]">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}