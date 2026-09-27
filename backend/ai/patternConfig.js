// Configuración de un patrón de evaluación (HU-13/14/15).
// El configurador maestro puede cambiar:
//  - el peso de cada área en el puntaje global,
//  - el peso de cada criterio dentro de un área,
//  - los rangos ideales de las métricas medidas (voz y cuerpo),
//  - las descripciones que guían a la IA evaluadora (coherencia y empatía),
//  - la exigencia general del evaluador.

const DEFAULT_CONFIG = {
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
function deepMerge(base, extra) {
  if (!isObject(extra)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] = isObject(value) && isObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

// Configuración completa de un patrón (compatible con patrones antiguos sin "config")
function resolveConfig(pattern) {
  if (!pattern) return DEFAULT_CONFIG;
  const legacy = {
    areas: {
      expression: pattern.expressionWeight,
      voice: pattern.voiceToneWeight,
      coherence: pattern.coherenceWeight,
      empathy: pattern.empathyWeight,
    },
    ...(pattern.empathyDescription ? { empathy: { descriptor: pattern.empathyDescription } } : {}),
  };
  return deepMerge(deepMerge(DEFAULT_CONFIG, legacy), pattern.config || {});
}

module.exports = { DEFAULT_CONFIG, resolveConfig, deepMerge };
