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
