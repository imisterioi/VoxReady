// Modo demostración (versión para Vercel): la API la simula el propio navegador
// (src/demo). Para usar el backend real, define VITE_DEMO_MODE=false en frontend/.env
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';

// URL base del backend. Se puede sobreescribir con VITE_API_URL en frontend/.env
export const API_URL = DEMO_MODE ? '' : import.meta.env.VITE_API_URL || 'http://localhost:3000';

const TOKEN_KEY = 'voxready_token';
const USER_KEY = 'voxready_user';

// ---------------------------------------------------------------- Sesión

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// ---------------------------------------------------------------- Llamadas

// fetch con token y manejo de errores. Lanza Error con el mensaje del backend.
export async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor. ¿Está corriendo el backend?');
  }

  const data = await response.json().catch(() => null);

  if (response.status === 401 && auth && token) {
    // Sesión expirada o cuenta suspendida: volver al login
    clearSession();
    if (!window.location.pathname.startsWith('/login')) window.location.assign('/login');
  }

  if (!response.ok) {
    const error = new Error(data?.mensaje || data?.error || `Error ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

// Compatibilidad con el código existente
export const apiGet = (path) => apiFetch(path);

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
