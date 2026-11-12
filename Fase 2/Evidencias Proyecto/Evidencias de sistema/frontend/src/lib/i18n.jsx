// Sistema de traducciones centralizado: el idioma activo decide qué diccionario se usa.
//
//  - `I18nProvider` envuelve la aplicación y expone el idioma activo y el diccionario (`d`).
//  - `useI18n()` da acceso a `lang`, `d`, `langVersion`, `setLanguage` (persistente) y `syncUser`.
//  - Precedencia del idioma: preferencia individual del usuario > idioma por defecto de su
//    organización > preferencia local (pre-login) > español.
//  - `langVersion` se incrementa cada vez que el idioma EFECTIVO cambia de verdad (no en cada
//    render ni al re-aplicar el mismo idioma). Los datos que el backend filtra por idioma —el
//    catálogo de escenarios— lo usan como dependencia para volver a pedirse cuando el idioma
//    cambia, sin navegar fuera de la pantalla ni recargar el navegador.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import I from '../data/dictionary';
import { apiFetch, getCurrentUser, getToken, saveSession } from './api';
import { canChangeLanguage, clearPracticeLock, lockedLanguage, readPracticeLock, writePracticeLock } from './practice/practiceLock';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_CODES as LANGUAGES,
  LANGUAGE_LABELS,
  effectiveCode,
  languageChanged,
  normalizeLanguage,
  resolveLanguage,
} from './language';

// Se reexporta la lógica pura para que los componentes la importen desde un único punto.
export { LANGUAGES, DEFAULT_LANGUAGE, LANGUAGE_LABELS, normalizeLanguage, resolveLanguage };

// Opciones listas para los selectores (código + etiqueta visible).
export const LANGUAGE_OPTIONS = LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_LABELS[code] }));

const LANGUAGE_KEY = 'voxready_language';
// Marca de selección explícita pendiente de guardar: una elección hecha en el login prevalece sobre
// la preferencia guardada.
const EXPLICIT_KEY = 'voxready_language_explicit';

function readStoredLanguage() {
  try {
    return normalizeLanguage(localStorage.getItem(LANGUAGE_KEY));
  } catch {
    return null;
  }
}

function writeStoredLanguage(lang) {
  try {
    localStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    /* almacenamiento no disponible */
  }
}

function readExplicit() {
  try {
    return normalizeLanguage(localStorage.getItem(EXPLICIT_KEY));
  } catch {
    return null;
  }
}

function markExplicit(lang) {
  try {
    localStorage.setItem(EXPLICIT_KEY, lang);
  } catch {
    /* almacenamiento no disponible */
  }
}

function clearExplicit() {
  try {
    localStorage.removeItem(EXPLICIT_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

// Idioma efectivo considerando también la selección guardada antes de iniciar sesión.
const effectiveLanguage = (user) => resolveLanguage(user, readStoredLanguage());

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  // Bloqueo del idioma durante la práctica: si existe, MANDA sobre la preferencia individual.
  // Se lee del almacenamiento para recuperarlo tras una recarga o al navegar atrás/adelante.
  const [lock, setLock] = useState(() => readPracticeLock());
  const [lang, setLang] = useState(() => lockedLanguage(readPracticeLock()) || effectiveLanguage(getCurrentUser()));

  // Señal de "idioma efectivo aplicado": los datos dependientes del idioma la usan como dependencia.
  const [langVersion, setLangVersion] = useState(0);
  const appliedLangRef = useRef(effectiveCode(lang));

  // Incrementa la versión solo cuando el idioma efectivo cambia de verdad: re-aplicar el mismo
  // idioma (p. ej. `syncUser` al montar) no dispara peticiones nuevas.
  const commitLanguage = useCallback((value) => {
    const code = effectiveCode(value);
    if (!languageChanged(appliedLangRef.current, code)) return;
    appliedLangRef.current = code;
    setLangVersion((version) => version + 1);
  }, []);

  // Persistencia de la preferencia SERIALIZADA: con cambios rápidos (es→en→es) el último guardado
  // enviado refleja siempre la última elección, sin respuestas que lleguen desordenadas.
  const persistQueueRef = useRef(Promise.resolve());
  const persistLanguage = useCallback((value) => {
    const send = () => apiFetch('/api/auth/language', { method: 'PATCH', body: { language: value } });
    // Un fallo previo no debe bloquear la cola: se reintenta el envío actual igualmente.
    const run = persistQueueRef.current.then(send, send);
    persistQueueRef.current = run.catch(() => {});
    return run;
  }, []);

  // Última elección pedida por el usuario: evita que una respuesta atrasada confirme un idioma que
  // el usuario ya abandonó.
  const requestedLangRef = useRef(null);

  // Aplica el idioma del usuario recibido del backend (p. ej. GET /api/auth/me).
  // Si hay una selección explícita pendiente (hecha en el login), se guarda como preferencia y
  // prevalece sobre la anterior: una elección reciente nunca queda tapada por una preferencia vieja.
  const syncUser = useCallback(async (user) => {
    // Durante una práctica el idioma de la sesión es la fuente de verdad: la preferencia del
    // usuario (ni una selección pendiente) no puede cambiarlo.
    const locked = lockedLanguage(readPracticeLock());
    if (locked) {
      setLang(locked);
      commitLanguage(locked);
      return user;
    }
    const pending = readExplicit();
    if (pending && getToken() && normalizeLanguage(user?.language) !== pending) {
      try {
        const { user: updated } = await persistLanguage(pending);
        if (updated) saveSession(getToken(), updated);
        clearExplicit();
        setLang(pending);
        writeStoredLanguage(pending);
        commitLanguage(pending);
        return updated || user;
      } catch {
        /* si el backend falla, se conserva la selección local */
      }
    }
    clearExplicit();
    const next = effectiveLanguage(user);
    setLang(next);
    writeStoredLanguage(next);
    commitLanguage(next);
    return user;
  }, [commitLanguage, persistLanguage]);

  // Cambio explícito de idioma (login o cabecera): se aplica al instante y, si hay sesión, se
  // guarda como preferencia individual (sobrescribe la anterior).
  // Durante una práctica NO se cambia nada: el bloqueo se comprueba aquí, no solo en la interfaz.
  const setLanguage = useCallback(async (next) => {
    if (!canChangeLanguage(readPracticeLock())) return { blocked: true };
    const value = normalizeLanguage(next) || DEFAULT_LANGUAGE;
    requestedLangRef.current = value;
    setLang(value);
    writeStoredLanguage(value);
    markExplicit(value);
    if (!getToken()) {
      commitLanguage(value);
      return null;
    }
    try {
      const { user } = await persistLanguage(value);
      if (user) saveSession(getToken(), user);
      clearExplicit();
      if (requestedLangRef.current === value) commitLanguage(value);
      return user;
    } catch (error) {
      clearExplicit();
      if (requestedLangRef.current === value) commitLanguage(value);
      throw error;
    }
  }, [commitLanguage, persistLanguage]);

  // ------------------------------------------------ Bloqueo del idioma durante la práctica

  // Activa el bloqueo con el idioma de la práctica. La interfaz pasa a ese idioma y NO se toca la
  // preferencia guardada del usuario: al liberar el bloqueo se recupera su idioma habitual.
  const setPracticeLock = useCallback(
    (value) => {
      const stored = writePracticeLock(value);
      if (!stored) return null;
      setLock(stored);
      setLang(stored.language);
      commitLanguage(stored.language);
      return stored;
    },
    [commitLanguage],
  );

  // Libera el bloqueo (práctica terminada o abandonada) y vuelve al idioma habitual del usuario.
  const releasePracticeLock = useCallback(() => {
    clearPracticeLock();
    setLock(null);
    const next = effectiveLanguage(getCurrentUser());
    setLang(next);
    writeStoredLanguage(next);
    commitLanguage(next);
  }, [commitLanguage]);

  const value = useMemo(
    () => ({
      lang,
      langVersion,
      d: I[lang] || I[DEFAULT_LANGUAGE],
      languages: LANGUAGES,
      labels: LANGUAGE_LABELS,
      // Bloqueo activo: la cabecera lo usa para deshabilitar el selector y explicar el motivo.
      languageLocked: Boolean(lock),
      lockedLanguage: lockedLanguage(lock),
      setLanguage,
      setPracticeLock,
      releasePracticeLock,
      syncUser,
    }),
    [lang, langVersion, lock, setLanguage, setPracticeLock, releasePracticeLock, syncUser],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// Fuera del proveedor devuelve español: los componentes aislados (pruebas) siguen funcionando.
export function useI18n() {
  return (
    useContext(I18nContext) || {
      lang: DEFAULT_LANGUAGE,
      langVersion: 0,
      d: I[DEFAULT_LANGUAGE],
      languages: LANGUAGES,
      labels: LANGUAGE_LABELS,
      languageLocked: false,
      lockedLanguage: null,
      setLanguage: async () => {},
      setPracticeLock: () => null,
      releasePracticeLock: () => {},
      syncUser: () => {},
    }
  );
}
