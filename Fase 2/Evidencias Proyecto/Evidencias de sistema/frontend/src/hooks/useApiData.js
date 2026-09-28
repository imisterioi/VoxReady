import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

// Carga datos de la API: { data, loading, error, reload }
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

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, reload };
}
