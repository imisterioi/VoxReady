// URL base del backend. Se puede sobreescribir con VITE_API_URL en frontend/.env
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function apiGet(path) {
  const response = await fetch(`${API_URL}${path}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.mensaje || `Error ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

// Consulta un endpoint y devuelve su estado (sin lanzar errores).
export async function checkEndpoint(path) {
  const start = performance.now();
  try {
    const res = await fetch(`${API_URL}${path}`);
    const body = await res.json().catch(() => null);
    return { state: res.ok ? 'ok' : 'error', status: res.status, ms: Math.round(performance.now() - start), body };
  } catch (err) {
    return { state: 'offline', status: null, ms: null, body: { error: err.message } };
  }
}
