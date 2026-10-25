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
// HISTORIA Y EVIDENCIA ACUMULADA (registro; la cabecera manda)
// ---------------------------------------------------------------------------------------------
//
// POR QUÉ EXISTE ESTE MÓDULO
// El incidente real (sesión 16863aa1-…, 23:25) terminó sin informe porque los tres modelos
// evaluadores fallaron: `moonshotai/kimi-k3` (HTTP 410, ya no publicado), `nvidia/nemotron-3-super-120b-a12b`
// (HTTP 404) y `google/gemma-4-31b-it` (timeout de 90 s). Los dos primeros venían de
// `backend/.env.local` y el tercero de un respaldo HARDCODEADO en `ai/evaluator.js`. El código
// cargaba `.env` y luego `.env.local` (ver `index.js`), así que el archivo de entorno tapaba
// cualquier valor por defecto del código: cambiar los defaults sin tocar el entorno no habría
// tenido efecto.
//
// REGLAS DE ESTE MÓDULO
//  - Una sola fuente de verdad para la lista de modelos evaluadores (la usa la evaluación final
//    y la comprobación anticipada de disponibilidad).
//  - Precedencia EXPLÍCITA: variables de entorno > valores por defecto VALIDADOS en este entorno.
//  - Los identificadores obsoletos se eliminan de los defaults: ya no hay respaldos de fábrica
//    que puedan reaparecer por olvido (el fallback sigue existiendo, pero solo con modelos
//    verificados).
//  - Nunca se inventan identificadores: todo valor sale del entorno o de esta lista validada.
//
// Validación real (sondas acotadas contra el proveedor, ver informe de la tarea; ninguna toca
// sesiones reales):
//  - `z-ai/glm-5.3`                         → responde y COMPLETA un informe sintético a tamaño real
//                                             (12/12 criterios, finish=stop, 54 s, cap 4000).
//  - `nvidia/nemotron-3.5-lightning-30b-a3b`→ responde con JSON utilizable a cap 4000 (20,8 s);
//                                             con caps pequeños se trunca (modelo con razonamiento).
//  - `moonshotai/kimi-k3`                   → HTTP 410 (ya no publicado).
//  - `nvidia/nemotron-3-super-120b-a12b`    → HTTP 404.
//  - `google/gemma-4-31b-it`                → timeout (lento).
//  - `z-ai/glm-5.3-flash`, `deepseek-ai/deepseek-v4.1-flash` → timeout.
//  - `moonshotai/kimi-k2.6`, `google/gemma-3-12b-it`, `mistralai/mixtral-8x22b-v0.1`,
//    `nv-mistralai/mistral-nemo-12b-instruct`, `nvidia/llama-3.1-nemotron-70b-instruct`,
//    `nvidia/llama-3.1-nemotron-51b-instruct`, `mistralai/mistral-large-2-instruct` → HTTP 404
//    (aparecen en el catálogo del proveedor pero no aceptan chat/completions).
// Único modelo evaluador VALIDADO a tamaño real de informe: `z-ai/glm-5.3` completó un informe
// sintético (12/12 criterios, finish=stop, 54 s, cap 4000). El resto de candidatos probados no
// superó la validación: `nvidia/nemotron-3.5-lightning-30b-a3b` responde al contrato pero se
// TRUNCA con la salida de un informe (razona y agota el presupuesto de tokens), y los demás
// devolvieron 404/410 o agotaron el timeout.
//
// LIMITACIÓN CONOCIDA: hoy no hay un segundo modelo evaluador validado, así que la redundancia de
// respaldos queda sin cubrir hasta que el proveedor publique uno que complete el informe. El
// mecanismo de respaldo sigue intacto: basta configurar `AI_EVAL_FALLBACK_MODEL` (o añadir un
// default validado aquí) cuando exista.
// (Consolidado arriba: la lista validada, los candidatos y el tope viven en la cabecera.)

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
