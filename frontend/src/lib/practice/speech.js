// Transcripción en vivo con el reconocimiento de voz del navegador
// (Chrome y Edge; gratis, sin configuración). Si no está disponible,
// la sesión ofrece responder por escrito.

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export const speechRecognitionSupported = Boolean(Recognition);

export function createRecognizer({ onUpdate, onError } = {}) {
  if (!Recognition) return null;

  const rec = new Recognition();
  rec.lang = 'es-CL';
  rec.continuous = true;
  rec.interimResults = true;

  let active = false;
  let finalText = '';

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += `${text.trim()} `;
      else interim += text;
    }
    onUpdate?.({ finalText: finalText.trim(), interim: interim.trim() });
  };

  // El navegador corta el reconocimiento tras silencios largos: se reinicia mientras esté activo
  rec.onend = () => {
    if (active) {
      try {
        rec.start();
      } catch {
        /* ya estaba iniciado */
      }
    }
  };

  rec.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    onError?.(event.error);
  };

  return {
    start() {
      finalText = '';
      active = true;
      try {
        rec.start();
      } catch {
        /* ya estaba iniciado */
      }
    },
    // Pausa sin perder lo transcrito (p. ej. mientras el entrevistador repite la pregunta)
    pause() {
      active = false;
      rec.stop();
    },
    resume() {
      active = true;
      try {
        rec.start();
      } catch {
        /* ya estaba iniciado */
      }
    },
    // Termina y devuelve el texto final
    stop() {
      active = false;
      rec.stop();
      return finalText.trim();
    },
    get text() {
      return finalText.trim();
    },
  };
}

// ------------------------------------------------------------- Muletillas

const FILLER_RE = /\b(e+h+|e+m+|m{2,}|este|o sea|bueno|pues|digamos|cachai|onda|como que|a ver)\b/gi;

export function analyzeText(text = '') {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const found = (text.match(FILLER_RE) || []).map((w) => w.toLowerCase());
  return { words, fillers: found.length, fillerWords: found };
}
