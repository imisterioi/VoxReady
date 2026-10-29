// MODELOS DEL EVALUADOR: resolución única, orden efectivo y saneado. Se consultan TODOS EN PARALELO
// dentro de un mismo intento (ver `ai/evaluator.js#judgeContent`) y gana el PRIMER informe que
// supere la validación completa.
//
// REGLAS DE ESTE MÓDULO
//  - Una sola fuente de verdad para la lista de modelos evaluadores (la usa la evaluación final y la
//    comprobación anticipada de disponibilidad).
//  - Precedencia EXPLÍCITA: variables de entorno > valores por defecto de este archivo.
//    `AI_EVAL_MODELS` acepta una LISTA separada por comas (es la forma recomendada de habilitar
//    varios modelos); `AI_EVAL_MODEL` y `AI_EVAL_FALLBACK_MODEL` siguen funcionando.
//  - Nunca se inventan identificadores: todo valor sale del entorno o de esta lista verificada.
//
// VALIDACIÓN REAL (sonda manual `scripts/probe-evaluator-models.js`, llamadas reales al proveedor;
// no toca sesiones ni forma parte de la suite):
//  - Catálogo del proveedor consultado en vivo: 85 modelos. Estar en el catálogo NO implica que el
//    modelo acepte `chat/completions`: varios responden 404 (comprobado el 2026-10-24).
//  - `z-ai/glm-5.3` → único modelo VALIDADO a tamaño real de informe (12/12 criterios, finish=stop).
//  - Los CANDIDATOS de abajo responden 200 al contrato con `max_tokens` pequeño. Que respondan no
//    equivale a que completen un informe: los que razonan agotan el presupuesto de tokens y devuelven
//    `finish_reason: length` (se descartan solos gracias a la validación dentro de la carrera).
const VALIDATED_DEFAULTS = ['z-ai/glm-5.3'];

// Candidatos habilitados: existen en el catálogo del proveedor, aceptan `chat/completions` y
// COMPLETARON un informe sintético a tamaño real con el prompt de producción (sonda real del
// 2026-10-24). Se consultan en paralelo con el validado: si alguno entrega antes un informe
// completo y válido, gana; si no, se descarta sin afectar a los demás.
//   nvidia/nemotron-3-ultra-550b-a55b → informe completo y válido (53,9 s, 1865 tokens).
//   openai/gpt-oss-20b                → informe completo y válido (29,9 s, 1234 tokens).
//   minimaxai/minimax-m3.1-flash      → informe completo y válido (30,5 s, 919 tokens).
// NO habilitados (evidencia medida, no suposición):
//   nvidia/nemotron-3.5-lightning-30b-a3b       → agota los tokens y se trunca (finish=length).
//   nvidia/nemotron-3-nano-omni-30b-a3b-reasoning→ responde, pero con puntajes incompletos.
//   nvidia/nemotron-3.5-super-vl-120b-a12b      → HTTP 500 (servicio no disponible).
//   google/gemma-4-31b-it, deepseek-ai/deepseek-v4.1-flash, z-ai/glm-5.3-flash → no responden.
//   nvidia/nemotron-3-super-120b-a12b, nvidia/nemotron-nano-3-30b-a3b, nvidia/nemotron-4-340b-instruct,
//   nvidia/llama-3.1-nemotron-ultra-253b-v1, mistralai/mistral-large, moonshotai/kimi-k2.6,
//   ibm/granite-3.0-8b-instruct, mistralai/mistral-7b-instruct-v0.3 → HTTP 404 aunque estén en el
//   catálogo: no aceptan chat/completions.
const CANDIDATE_DEFAULTS = [
  'nvidia/nemotron-3-ultra-550b-a55b',
  'openai/gpt-oss-20b',
  'minimaxai/minimax-m3.1-flash',
];

const DEFAULT_MODELS = [...VALIDATED_DEFAULTS, ...CANDIDATE_DEFAULTS];

// Tope defensivo: cada modelo habilitado es una solicitud en paralelo (y su coste). Se consulta a
// TODOS los habilitados; el tope solo impide que una lista mal escrita dispare decenas de peticiones.
const MAX_MODELS = 6;

// ---------------------------------------------------------------------------------------------
// COBERTURA DE RESPALDOS
// ---------------------------------------------------------------------------------------------
// LIMITACIÓN CONOCIDA: no hay todavía un segundo modelo evaluador validado a tamaño real de
// informe, así que la redundancia de respaldos no está cubierta. El mecanismo sigue disponible:
// basta configurar `AI_EVAL_FALLBACK_MODEL` (o añadir un default validado aquí) cuando exista un
// modelo que complete el informe.

// Saneado: texto, sin espacios sobrantes, sin vacíos, sin duplicados, con tope.
function cleanList(values = []) {
  const out = [];
  for (const value of values) {
    for (const item of String(value ?? '').split(',')) {
      const model = item.trim();
      if (!model) continue;
      if (!out.includes(model)) out.push(model);
      if (out.length >= MAX_MODELS) return out;
    }
  }
  return out;
}

// Lista efectiva de modelos evaluadores, en orden de prioridad. TODOS los devueltos se consultan
// EN PARALELO dentro de un mismo intento; el orden solo decide el turno en los registros.
function evaluatorModels({ env = process.env, defaults = DEFAULT_MODELS } = {}) {
  const fromEnv = cleanList([env.AI_EVAL_MODELS, env.AI_EVAL_MODEL, env.AI_EVAL_FALLBACK_MODEL]);
  const list = [...fromEnv, ...cleanList(defaults)];
  return [...new Set(list)].slice(0, MAX_MODELS);
}

// ¿De dónde salió la configuración? Solo para el registro técnico (nunca para la interfaz).
function evaluatorModelsSource({ env = process.env } = {}) {
  const fromEnv = cleanList([env.AI_EVAL_MODELS, env.AI_EVAL_MODEL, env.AI_EVAL_FALLBACK_MODEL]);
  return {
    fromEnv,
    defaults: cleanList(DEFAULT_MODELS),
    validated: cleanList(VALIDATED_DEFAULTS),
    candidates: cleanList(CANDIDATE_DEFAULTS),
    envOverrides: fromEnv.length > 0,
  };
}

module.exports = {
  evaluatorModels,
  evaluatorModelsSource,
  cleanList,
  VALIDATED_DEFAULTS,
  CANDIDATE_DEFAULTS,
  DEFAULT_MODELS,
  MAX_MODELS,
};
