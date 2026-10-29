// Umbrales de tiempo de la sesión de entrevista (en milisegundos).
//
// Se separan del componente para poder probarlos sin navegador.
//  - NO_ANSWER_MS: el vocero no ha hablado nada tras la pregunta → el entrevistador interviene.
//  - END_SILENCE_MS: el vocero habló y luego guarda silencio → se da por terminada la respuesta
//    y la entrevista avanza sola. Es el único umbral del avance automático.
export const NO_ANSWER_MS = 12000;
export const END_SILENCE_MS = 10000;

// Tiempo que falta (ms) para que se dispare el avance automático. Negativo = ya venció.
export function silenceRemainingMs({ spoke, quietForMs }) {
  const limit = spoke ? END_SILENCE_MS : NO_ANSWER_MS;
  return limit - quietForMs;
}

// ¿Corresponde avanzar por silencio? El llamador debe cerrar el temporizador tras usarlo
// (el intervalo se limpia en finishAnswer), de modo que un mismo episodio no avance dos veces.
export function isSilenceAdvance({ spoke, quietForMs }) {
  return quietForMs >= (spoke ? END_SILENCE_MS : NO_ANSWER_MS);
}
