import { useEffect, useState } from 'react';

const KEY = 'voxready_theme';

const readTheme = () => {
  try {
    return localStorage.getItem(KEY) === 'dark';
  } catch {
    return false;
  }
};

// Tema claro/oscuro persistido en localStorage (misma clave que la versión anterior).
export default function useTheme() {
  const [isDark, setIsDark] = useState(readTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');
    try {
      localStorage.setItem(KEY, isDark ? 'dark' : 'light');
    } catch {
      /* almacenamiento no disponible */
    }
  }, [isDark]);

  return { isDark, toggleTheme: () => setIsDark((v) => !v) };
}
