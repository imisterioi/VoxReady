// Biblioteca inicial de escenarios generales (los administra el equipo de VoxReady).
// No contienen datos de ninguna organización ni de personas: sirven a cualquier
// rubro y todos los voceros los ven en la pestaña "Generales".
// Copia para la demo: frontend/src/demo/library.js (mantener ambas iguales).
const LIBRARY_SCENARIOS = [
  {
    title: 'Corte prolongado de un servicio esencial',
    category: 'CRISIS',
    optic: 'Empática',
    context:
      'Una falla técnica dejó a miles de clientes sin servicio durante más de 12 horas. La organización tardó en informar y en redes sociales crecen las críticas. Enfrentas una entrevista en vivo.',
    keyMessages: [
      'Lamentamos el impacto que esta interrupción tuvo en las personas y familias afectadas.',
      'El servicio ya está restablecido y identificamos la causa de la falla.',
      'Compensaremos a los clientes afectados de forma automática.',
      'Mejoraremos nuestros tiempos de aviso para informar mucho antes.',
    ],
    redLines: ['Culpar a los clientes, al clima o a terceros sin evidencia.', 'Minimizar el impacto diciendo que "no fue tan grave".', 'Prometer plazos o montos que no están confirmados.'],
  },
  {
    title: 'Filtración de datos de clientes',
    category: 'CRISIS',
    optic: 'Formal',
    context:
      'Se detectó un acceso no autorizado a una base de datos con nombres, correos y teléfonos de clientes. Aún se investiga el alcance. Un periodista de tecnología te entrevista.',
    keyMessages: [
      'Detectamos el acceso, lo contuvimos y lo informamos a la autoridad correspondiente.',
      'No se expusieron contraseñas ni datos bancarios según la investigación actual.',
      'Contactaremos a cada persona afectada con recomendaciones concretas.',
    ],
    redLines: ['Prometer que "nunca más va a pasar".', 'Culpar a los clientes por usar contraseñas débiles.', 'Dar cifras de afectados que aún no están confirmadas.'],
  },
  {
    title: 'Retiro preventivo de un producto',
    category: 'CRISIS',
    optic: 'Empática',
    context:
      'Se detectó un defecto en un lote de productos que podría causar lesiones. La organización anunció un retiro preventivo y hay consumidores preocupados por lo que ya compraron.',
    keyMessages: [
      'La seguridad de las personas es nuestra prioridad: por eso retiramos el lote de forma preventiva.',
      'Quienes tengan el producto pueden devolverlo y recibir el reembolso completo.',
      'Investigamos el origen del defecto junto a la autoridad sanitaria.',
    ],
    redLines: ['Minimizar el riesgo para los consumidores.', 'Culpar al proveedor antes de terminar la investigación.'],
  },
  {
    title: 'Accidente laboral grave',
    category: 'CRISIS',
    optic: 'Empática',
    context:
      'Un trabajador resultó gravemente herido en las instalaciones de la organización. La familia y el sindicato exigen respuestas y la prensa está en la entrada del recinto.',
    keyMessages: [
      'Nuestra prioridad es el trabajador y su familia, a quienes estamos acompañando.',
      'Colaboramos plenamente con la investigación de la autoridad.',
      'Revisaremos todos nuestros protocolos de seguridad.',
    ],
    redLines: ['Especular sobre las causas o responsabilizar al trabajador.', 'Entregar datos personales o médicos del afectado.'],
  },
  {
    title: 'Denuncia viral en redes sociales',
    category: 'CRISIS',
    optic: 'Empática',
    context:
      'Un video de un cliente denunciando un mal trato por parte de personal de la organización se volvió viral. Miles de comentarios piden una respuesta y un medio digital te contacta.',
    keyMessages: [
      'Lamentamos lo que vivió la persona y ya la contactamos directamente.',
      'Estamos revisando lo ocurrido con todos los antecedentes.',
      'Ese trato no representa nuestros valores y tomaremos medidas si corresponde.',
    ],
    redLines: ['Desacreditar a la persona que denuncia.', 'Anunciar sanciones antes de terminar la revisión.'],
  },
  {
    title: 'Impacto ambiental en la comunidad',
    category: 'CRISIS',
    optic: 'Técnica',
    context:
      'Vecinos denuncian olores y una posible contaminación de un estero cercano a una planta de la organización. La autoridad ambiental inició una fiscalización.',
    keyMessages: [
      'Nos tomamos en serio la preocupación de los vecinos y estamos en terreno.',
      'Entregaremos a la autoridad toda la información y los monitoreos disponibles.',
      'Si se confirma un impacto, nos haremos cargo de su reparación.',
    ],
    redLines: ['Negar el problema antes de tener resultados.', 'Culpar a otras empresas de la zona sin evidencia.'],
  },
  {
    title: 'Anuncio de alza de precios',
    category: 'MEDIOS',
    optic: 'Técnica',
    context:
      'La organización anunció un alza de precios a partir del próximo mes, en medio de críticas de asociaciones de consumidores. Un programa de radio te invita a explicarla.',
    keyMessages: [
      'El alza responde al aumento de nuestros costos y no a mayores ganancias.',
      'Habrá beneficios para los clientes más vulnerables.',
      'Seguiremos buscando eficiencias para moderar futuros ajustes.',
    ],
    redLines: ['Culpar a la autoridad o a terceros sin evidencia.', 'Minimizar el impacto en el presupuesto de las familias.'],
  },
  {
    title: 'Presentación de resultados anuales',
    category: 'MEDIOS',
    optic: 'Técnica',
    context:
      'Un medio económico te entrevista tras la publicación de los resultados anuales: subieron las utilidades, pero también se cerraron algunas sucursales.',
    keyMessages: [
      'Los resultados reflejan un año de mayor eficiencia operacional.',
      'Las personas de las sucursales cerradas fueron reubicadas.',
      'Seguiremos invirtiendo en mejorar la atención a nuestros clientes.',
    ],
    redLines: ['Prometer inversiones o cifras que no están aprobadas.'],
  },
  {
    title: 'Lanzamiento de un nuevo proyecto',
    category: 'MEDIOS',
    optic: 'Formal',
    context:
      'La organización anuncia un nuevo proyecto que generará empleo en la zona, pero un grupo de vecinos teme por su impacto. Das una conferencia de prensa.',
    keyMessages: [
      'El proyecto generará empleo local y priorizará a personas de la comuna.',
      'Cumpliremos con todas las evaluaciones y permisos exigidos.',
      'Abriremos instancias de diálogo con la comunidad.',
    ],
    redLines: ['Prometer plazos de apertura no confirmados.', 'Descalificar las preocupaciones de los vecinos.'],
  },
  {
    title: 'Entrevista sobre una polémica en la industria',
    category: 'MEDIOS',
    optic: 'Formal',
    context:
      'Otra empresa del rubro está envuelta en un escándalo y el periodista busca saber si tu organización tiene prácticas similares.',
    keyMessages: [
      'Nuestra organización cumple con la normativa y es auditada periódicamente.',
      'Respetamos los procesos de investigación en curso.',
    ],
    redLines: ['Opinar o especular sobre el caso de otra empresa.', 'Asegurar que "en nuestra empresa jamás podría pasar".'],
  },
  {
    title: 'Comunicar una reestructuración interna',
    category: 'INSTITUCIONAL',
    optic: 'Empática',
    context:
      'La organización reorganizará áreas completas y algunas personas cambiarán de funciones. Hay inquietud interna y rumores de despidos.',
    keyMessages: [
      'El objetivo de la reorganización es fortalecer la organización a largo plazo.',
      'Acompañaremos a cada persona durante la transición.',
      'Informaremos cada etapa de forma directa y oportuna.',
    ],
    redLines: ['Minimizar las preocupaciones de los trabajadores.', 'Negar cambios que sí están contemplados.'],
  },
  {
    title: 'Cambio de liderazgo en la organización',
    category: 'INSTITUCIONAL',
    optic: 'Formal',
    context:
      'La máxima autoridad de la organización deja su cargo de forma inesperada. Accionistas, trabajadores y prensa preguntan qué pasará con la estrategia.',
    keyMessages: [
      'La organización tiene un plan de sucesión y la operación sigue con normalidad.',
      'La estrategia y los compromisos con nuestros clientes se mantienen.',
    ],
    redLines: ['Especular sobre los motivos personales de la salida.', 'Anunciar nombres de reemplazo no confirmados.'],
  },
];

module.exports = { LIBRARY_SCENARIOS };
