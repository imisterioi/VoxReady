// Dispara el precalentamiento del entrevistador UNA vez por sesión, sin bloquear la
// preparación. Puro respecto a la red: recibe `post` inyectado y se prueba sin navegador.
//
// Garantías:
//  - una sola solicitud por sesión, aunque el componente se re-renderice o cambie de fase;
//  - nunca lanza ni rechaza: un fallo de precalentamiento no debe bloquear al vocero;
//  - ignora la respuesta si la sesión ya no es la activa (desmontaje o cambio de práctica).
export function createPrewarmTrigger({ post, isCurrentSession = () => true } = {}) {
  let startedFor = null;
  let inflight = null;

  return {
    async start(sessionId) {
      if (!sessionId) return { ok: false, reason: 'NO_SESSION' };
      if (startedFor === sessionId) return { ok: true, deduped: true, pending: Boolean(inflight) };
      startedFor = sessionId;

      inflight = Promise.resolve()
        .then(() => post(sessionId))
        .then((result) => (isCurrentSession(sessionId) ? { ok: true, result } : { ok: false, reason: 'STALE' }))
        .catch(() => ({ ok: false, reason: 'ERROR' }))
        .finally(() => {
          inflight = null;
        });

      return inflight;
    },
    isStarted: (sessionId) => startedFor === sessionId,
    isPending: () => Boolean(inflight),
    // Permite precalentar de nuevo una sesión distinta (nueva práctica).
    reset() {
      startedFor = null;
      inflight = null;
    },
  };
}
