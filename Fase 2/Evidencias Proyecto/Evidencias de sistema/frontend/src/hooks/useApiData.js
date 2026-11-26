import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { REFRESH_EVENT } from '../lib/liveRefresh';

// Carga datos de la API: { data, loading, error, reload }
// Cuando el latido del layout detecta novedades (REFRESH_EVENT) recarga en silencio: sin mostrar
// «cargando» y conservando lo que ya se ve si la consulta falla.
export default function useApiData(path) {
  const [state, setState] = useState({ data: null, loading: Boolean(path), error: '' });

  const reload = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await apiFetch(path);
      setState({ data, loading: false, error: '' });
    } catch (error) {
      setState({ data: null, loading: false, error: error.message });
    }
  }, [path]);

  const refreshQuietly = useCallback(async () => {
    if (!path) return;
    try {
      const data = await apiFetch(path);
      setState({ data, loading: false, error: '' });
    } catch {
      /* se conserva lo que ya se mostraba */
    }
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    window.addEventListener(REFRESH_EVENT, refreshQuietly);
    return () => window.removeEventListener(REFRESH_EVENT, refreshQuietly);
  }, [refreshQuietly]);

  return { ...state, reload };
}
