// Copia de backend/ai/patternConfig.js para el modo demostración (solo frontend).
// Configuración de un patrón de evaluación: pesos por área, criterios, rangos ideales
// y descriptores que guían al evaluador.

export const DEFAULT_CONFIG = {
  strictness: 'normal', // flexible | normal | exigente
  areas: { expression: 25, voice: 25, coherence: 30, empathy: 20 },

  voice: {
    criteria: {
      wpm: { label: 'Velocidad al hablar', weight: 3, idealMin: 120, idealMax: 165 },
      fillers: { label: 'Muletillas', weight: 3, tolerancePerMin: 2 },
      pauses: { label: 'Pausas largas', weight: 2, tolerancePerAnswer: 1 },
      variation: { label: 'Variación de volumen (no monótono)', weight: 1, idealMin: 35, idealMax: 90 },
      latency: { label: 'Tiempo antes de responder', weight: 1, idealMaxSec: 2.5 },
    },
  },

  expression: {
    criteria: {
      presence: { label: 'Presencia en cámara', weight: 2, idealMinPct: 90 },
      facing: { label: 'Mirada hacia la cámara', weight: 3, idealMinPct: 75 },
      posture: { label: 'Postura (hombros nivelados)', weight: 2, idealMaxDeg: 4 },
      head: { label: 'Estabilidad de la cabeza', weight: 2 },
      hands: { label: 'Gestos con las manos', weight: 1 },
    },
  },

  coherence: {
    descriptor: 'Un buen vocero sostiene sus mensajes clave aunque lo presionen, responde lo que se le pregunta y no se contradice.',
    criteria: {
      keyMessages: { label: 'Sostiene los mensajes clave', weight: 3 },
      directness: { label: 'Responde directo, sin evadir', weight: 2 },
      redLines: { label: 'Evita las líneas rojas', weight: 3 },
      clarity: { label: 'Claridad y estructura', weight: 1 },
    },
  },

  empathy: {
    descriptor: 'Reconoce explícitamente el impacto en las personas afectadas antes de dar datos técnicos, con un tono humano.',
    visualWeight: 20, // % de la empatía que aporta mirar a la cámara
    criteria: {
      impact: { label: 'Reconoce el impacto en las personas', weight: 3 },
      warmth: { label: 'Calidez y tono humano', weight: 2 },
      responsibility: { label: 'Asume responsabilidad', weight: 2 },
    },
  },
};

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Mezcla profunda: lo guardado sobrescribe los valores por defecto
export function deepMerge(base, extra) {
  if (!isObject(extra)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] = isObject(value) && isObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

export function resolveConfig(pattern) {
  if (!pattern) return DEFAULT_CONFIG;
  return deepMerge(DEFAULT_CONFIG, pattern.config || {});
}

// Las listas de los temas se guardan como texto JSON (igual que en la base de datos real)
export function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    /* texto plano */
  }
  return [String(value)];
}
