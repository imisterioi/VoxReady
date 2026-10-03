import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DEMO_PASSWORD, TEST_USERS } from '../data/mockData';
import { apiFetch, clearSession, getCurrentUser, saveSession } from '../lib/api';
import { newPathFor } from '../demo/versions';

// Entrada desde la versión antigua (switch flotante): inicia sesión con el perfil
// de demostración del mismo rol y abre la pantalla equivalente.
// /demo/entrar?role=admin&s=a2
export default function DemoEntry() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const role = params.get('role');
    const testUser = TEST_USERS.find((u) => u.role === role);
    if (!testUser) {
      clearSession();
      navigate('/login', { replace: true });
      return;
    }
    const target = newPathFor(params.get('s'), params.get('leccion'));

    (async () => {
      try {
        if (getCurrentUser()?.role !== role) {
          const { token, user } = await apiFetch('/api/auth/login', {
            method: 'POST',
            auth: false,
            body: { email: testUser.email, password: DEMO_PASSWORD },
          });
          saveSession(token, user);
        }
        // La preparación y la sesión necesitan un escenario elegido
        if (['/vocero/preparar', '/vocero/sesion'].includes(target) && !sessionStorage.getItem('voxready_escenario_seleccionado')) {
          const { scenarios } = await apiFetch(`/api/scenarios/my?email=${encodeURIComponent(testUser.email)}`);
          if (scenarios?.[0]) sessionStorage.setItem('voxready_escenario_seleccionado', JSON.stringify(scenarios[0]));
        }
        navigate(target, { replace: true });
      } catch {
        navigate('/login', { replace: true });
      }
    })();
  }, [params, navigate]);

  return (
    <div className="h-dvh flex items-center justify-center bg-canvas">
      <span className="h-6 w-6 rounded-full border-2 border-line border-t-ink animate-spin" aria-label="Cargando" />
    </div>
  );
}
