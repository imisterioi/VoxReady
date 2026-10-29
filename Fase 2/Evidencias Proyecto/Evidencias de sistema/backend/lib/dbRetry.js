// Utilidad de reintento con espera progresiva para operaciones de Prisma.
// Solo se reintentan errores transitorios de conexión (no errores de datos ni de programación).
//
// Errores reintentables:
//   - P1001 (Can't reach database server)
//   - EAI_AGAIN / EAI_NONAME (resolución DNS transitoria)
//   - ECONNREFUSED, ECONNRESET, ETIMEDOUT (conexión caída)
//   - 57P01 (admin shutdown), 53300 (too many connections)
//
// Errores NO reintentables:
//   - P2000-P2999 (validación de datos, restricciones de clave foránea, etc.)
//   - Cualquier error que no coincida con los patrones anteriores

const TRANSIENT_CODES = [
  'P1001',       // Can't reach database server
  '57P01',       // admin shutdown
  '53300',       // too many connections
];

const TRANSIENT_PATTERNS = [
  /EAI_AGAIN/i,
  /EAI_NONAME/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /Can't reach database server/i,
  /getaddrinfo/i,
];

function isTransientError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (TRANSIENT_CODES.includes(code)) return true;
  const message = String(error.message || '');
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ejecuta `fn` con reintentos limitados y espera progresiva.
// Devuelve el resultado de `fn` si tiene éxito.
// Lanza el último error si se agotan los intentos.
async function withRetry(fn, {
  maxAttempts = 5,
  baseDelayMs = 1000,
  maxDelayMs = 30000,
  onRetry = () => {},
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error)) throw error;
      if (attempt === maxAttempts) throw error;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      onRetry({ attempt, delay, error });
      await sleep(delay);
    }
  }
  throw lastError;
}

module.exports = { withRetry, isTransientError };
