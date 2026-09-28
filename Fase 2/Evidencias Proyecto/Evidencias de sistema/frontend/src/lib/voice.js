import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Voz del entrevistador (síntesis de voz del navegador, gratis).
//
// Cada navegador trae voces distintas. Las más humanas son las "Natural"
// de Microsoft Edge (p. ej. "Catalina" y "Lorenzo" de Chile) y, en Chrome,
// las voces "Google español". Aquí se elige la mejor disponible y se
// recuerda la elección del usuario.
// ---------------------------------------------------------------------------

const KEY = 'voxready_voice';

// Puntaje de "naturalidad" de una voz: mayor = más humana
function scoreVoice(voice) {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;

  if (/natural|neural|online/.test(name)) score += 100; // voces neuronales (Edge)
  if (/google/.test(name)) score += 60; // voces en la nube de Chrome
  if (!voice.localService) score += 10; // las voces en línea suelen ser mejores

  if (lang === 'es-cl') score += 30; // acento chileno primero
  else if (/^es-(419|mx|ar|co|pe|us)$/.test(lang)) score += 20; // luego Latinoamérica
  else if (lang === 'es-es') score += 10;

  if (/sabina|helena|laura|pablo/.test(name) && !/natural|online/.test(name)) score -= 20; // voces antiguas de Windows
  return score;
}

export function getSpanishVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('es'))
    .sort((a, b) => scoreVoice(b) - scoreVoice(a));
}

export function isNaturalVoice(voice) {
  return scoreVoice(voice) >= 60;
}

// Nombre corto para mostrar: "Microsoft Catalina Online (Natural) - Spanish (Chile)" → "Catalina · Chile"
export function voiceLabel(voice) {
  const clean = voice.name
    .replace(/^Microsoft\s+/i, '')
    .replace(/\s*Online\s*\(Natural\)/i, '')
    .replace(/\s*-\s*Spanish\s*\(([^)]+)\)/i, ' · $1');
  return isNaturalVoice(voice) ? `${clean} (natural)` : clean;
}

// Hook: lista de voces en español + voz elegida (persistida)
export function useInterviewerVoice() {
  const [voices, setVoices] = useState(getSpanishVoices);
  const [voiceURI, setVoiceURIState] = useState(() => {
    try {
      return localStorage.getItem(KEY) || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    if (!window.speechSynthesis) return;
    // Las voces se cargan de forma asíncrona en la mayoría de navegadores
    const update = () => setVoices(getSpanishVoices());
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);

  const setVoiceURI = (uri) => {
    setVoiceURIState(uri);
    try {
      localStorage.setItem(KEY, uri);
    } catch {
      /* almacenamiento no disponible */
    }
  };

  // Si la voz guardada ya no existe, se usa la más natural disponible
  const voice = voices.find((v) => v.voiceURI === voiceURI) || voices[0] || null;

  return { voices, voice, setVoiceURI };
}

// Lee un texto con la voz indicada. Devuelve la utterance para escuchar eventos.
export function speak(text, voice, { onStart, onEnd } = {}) {
  if (!window.speechSynthesis) return null;
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = 'es-CL';
  }
  // Las voces naturales ya tienen buena entonación; las básicas suenan mejor un poco más lentas
  utterance.rate = voice && isNaturalVoice(voice) ? 1 : 0.95;
  utterance.pitch = 1;

  utterance.onstart = () => onStart?.();
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();

  window.speechSynthesis.speak(utterance);
  return utterance;
}
