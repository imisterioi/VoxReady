// Clasificación de los errores de evaluación (solo backend). NO cambia la política de reintentos:
// identifica la naturaleza del fallo para (a) registrarlo con precisión, (b) elegir un mensaje
// comprensible para el vocero y (c) señalar cuándo hace falta revisión técnica.
//
// Criterio:
//  - `transient`: el intento puede tener éxito más adelante (timeout, red, 5xx, 429, respuesta
//    vacía/truncada o no validable). Se reintenta según la política vigente.
//  - `permanent`: el mismo error se repetirá mientras no se corrija la configuración o los datos
//    (credenciales, modelo inexistente/retirado, entrada no evaluable, audio no separable).
//  - Nunca se exponen al vocero códigos, modelos ni detalles internos.
const TRANSIENT_PATTERNS = [
  /tiempo agotado/i,
  /\bTIMEOUT\b/i,
  /\bNETWORK\b/i,
  /HTTP[ _]?(408|425|429|5\d\d)/i,
  /respuesta incompleta/i,
  /JSON sin puntajes/i,
  /no contiene JSON/i,
  // Respuesta que llegó pero no sirve como informe: otro modelo (o el siguiente intento) puede
  // completarla. NO es un problema de configuración.
  /puntajes inválidos/i,
  /estructura inválida/i,
  /sin JSON/i,
  /conexión interrumpida/i,
  /sin conexión con el proveedor/i,
  /EMPTY/i,
  /BUSY/i,
  /SERVICE_DOWN/i,
];

const PERMANENT_PATTERNS = [
  /HTTP[ _]?(400|401|403|404|410|422)/i,
  /NO_API_KEY/,
  /NO_KEY/,
  /NO_MODELS/,
  /INVALID_INPUT/,
  /CONTEXT_BUILD_FAILED/,
  /NO_WINDOWS/,
];

const TRANSIENT_MESSAGE =
  'El servicio de generación no está disponible en este momento. El informe se volverá a intentar automáticamente.';
const PERMANENT_MESSAGE = 'No pudimos preparar el informe de esta práctica. Nuestro equipo lo está revisando.';

const testAny = (patterns, value) => patterns.some((pattern) => pattern.test(String(value || '')));

// `reasons`: motivos por modelo/intento (p. ej. los de `judgeContent.failed`). Si TODOS son
// permanentes, el fallo es permanente; cualquier motivo temporal lo mantiene reintentable.
function classifyEvaluationError({ code = '', reasons = [] } = {}) {
  const list = (Array.isArray(reasons) ? reasons : [reasons]).filter(Boolean).map((item) => item?.reason || item);
  const permanent = list.length > 0 && list.every((reason) => testAny(PERMANENT_PATTERNS, reason));
  const explicitPermanent = testAny(PERMANENT_PATTERNS, code) && !testAny(TRANSIENT_PATTERNS, code);
  const kind = permanent || explicitPermanent ? 'permanent' : 'transient';
  return {
    kind,
    needsReview: kind === 'permanent',
    userMessage: kind === 'permanent' ? PERMANENT_MESSAGE : TRANSIENT_MESSAGE,
  };
}

module.exports = { classifyEvaluationError, TRANSIENT_MESSAGE, PERMANENT_MESSAGE };
