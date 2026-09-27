// Microlecciones: teoría breve + video público de YouTube + ejemplo comentado.
// "area" vincula la lección con el área del informe que ayuda a mejorar,
// para recomendarla según el punto más débil del vocero.

export const LESSONS = [
  {
    id: 'mensajes-clave',
    title: 'Mensajes clave que se recuerdan',
    area: 'coherence',
    icon: 'message',
    minutes: 4,
    objective: 'Resumir tu postura en frases cortas y citables que el periodista no pueda sacar de contexto.',
    points: [
      'Prepara máximo 3 mensajes clave antes de cada entrevista.',
      'Formula cada mensaje en una frase de 10 a 15 palabras, fácil de citar.',
      'Repite tus mensajes con distintas palabras a lo largo de la entrevista.',
    ],
    video: { id: '1vbWtbuC5TY', title: 'Un buen vocero sabe hablar en soundbites', author: 'Carolina Eslava' },
    example: {
      before: 'Bueno, hay varios factores técnicos, operativos y de coordinación que estamos evaluando en distintas mesas de trabajo…',
      after: 'Nuestra prioridad hoy es una sola: que ninguna familia quede sin suministro esta noche.',
    },
  },
  {
    id: 'preguntas-hostiles',
    title: 'Preguntas hostiles y técnica puente',
    area: 'coherence',
    icon: 'zap',
    minutes: 3,
    objective: 'Reconocer la pregunta difícil sin evadirla y volver a tu mensaje clave (técnica puente).',
    points: [
      'Reconoce la pregunta: "Entiendo la preocupación…".',
      'Responde lo esencial con honestidad, aunque sea "aún no lo sabemos".',
      'Usa un puente ("lo importante es…", "lo que sí puedo confirmar…") y vuelve a tu mensaje.',
      'Nunca repitas las palabras negativas de la pregunta.',
    ],
    video: { id: 'm8jyYIZwc28', title: 'Media training: ganándole a los periodistas', author: 'Javier Maza' },
    example: {
      before: '"No voy a responder eso. Siguiente pregunta."',
      after: '"Entiendo la preocupación. Lo que sí puedo confirmar es que ningún cliente está en riesgo y que ya contactamos a cada uno."',
    },
  },
  {
    id: 'preparar-entrevista',
    title: 'Cómo prepararte para salir en la prensa',
    area: 'coherence',
    icon: 'target',
    minutes: 12,
    objective: 'Llegar a la entrevista sabiendo qué quieres decir, qué te van a preguntar y qué nunca debes decir.',
    points: [
      'Investiga el medio, el periodista y el formato (en vivo, grabado, escrito).',
      'Anticipa las 5 preguntas más difíciles y ensaya tus respuestas en voz alta.',
      'Define tus líneas rojas: lo que no dirás aunque te presionen.',
    ],
    video: { id: 'TJAbOeb7NEA', title: 'Media training: 7 claves prácticas', author: 'Daniel Colombo' },
    example: {
      before: 'Llegar a la entrevista "a ver qué me preguntan".',
      after: 'Llegar con 3 mensajes clave, 5 preguntas difíciles ensayadas y 2 líneas rojas claras.',
    },
  },
  {
    id: 'comunicar-en-crisis',
    title: 'Hablar en una crisis: primero las personas',
    area: 'empathy',
    icon: 'users',
    minutes: 8,
    objective: 'Estructurar una declaración de crisis que muestre empatía, responsabilidad y acción.',
    points: [
      'Empieza por las personas afectadas, no por los datos técnicos.',
      'Di lo que sabes, lo que no sabes y cuándo volverás a informar.',
      'Asume responsabilidad sin culpar a terceros ni especular.',
    ],
    video: { id: 'c5Yp5GxdUBc', title: 'Rueda de prensa: situación de crisis', author: 'Nacho Lain Coubert' },
    example: {
      before: '"La falla se debió a factores climáticos excepcionales fuera de nuestro control."',
      after: '"Lamentamos profundamente lo que viven las familias afectadas. Asumimos la responsabilidad y esto es lo que estamos haciendo…"',
    },
  },
  {
    id: 'lenguaje-no-verbal',
    title: 'Lenguaje no verbal frente a la cámara',
    area: 'expression',
    icon: 'person',
    minutes: 4,
    objective: 'Que tu cuerpo respalde tu mensaje: mirada, postura y gestos que transmiten confianza.',
    points: [
      'Mira a la cámara (o al entrevistador) sobre todo al decir tus mensajes clave.',
      'Hombros nivelados y espalda recta; evita balancearte.',
      'Gestos abiertos y moderados a la altura del pecho.',
    ],
    video: { id: '4Bs1ssOX5SY', title: 'Comunicación no verbal', author: 'Dr. Sergio Rulicki' },
    example: {
      before: 'Desviar la mirada y cruzar los brazos justo al hablar de los afectados.',
      after: 'Sostener la mirada y hacer una pausa breve al reconocer el impacto en las personas.',
    },
  },
  {
    id: 'controlar-nervios',
    title: 'Controlar los nervios y la voz',
    area: 'voice',
    icon: 'mic',
    minutes: 4,
    objective: 'Usar la respiración para hablar más pausado, sin muletillas y con firmeza.',
    points: [
      'Respira por el abdomen antes de responder: 4 segundos inhalar, 4 exhalar.',
      'Reemplaza las muletillas ("eh", "este") por una pausa en silencio.',
      'Apunta a 120–160 palabras por minuto; baja la velocidad en los mensajes clave.',
    ],
    video: { id: 'FbJ4_bS98Ls', title: 'Ejercicio de respiración para hablar con seguridad', author: 'Sebastián Lora' },
    example: {
      before: '"Eh… bueno, este, la verdad es que, eh, estamos trabajando."',
      after: '(pausa) "Estamos trabajando con todos nuestros equipos en terreno."',
    },
  },
];

export const getLesson = (id) => LESSONS.find((l) => l.id === id);

// Lecciones recomendadas para un área débil (o las primeras si no hay datos)
export function lessonsForArea(areaKey, limit = 2) {
  const matches = LESSONS.filter((l) => l.area === areaKey);
  return (matches.length ? matches : LESSONS).slice(0, limit);
}
