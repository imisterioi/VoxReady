// Guarda de regresión de traducciones: las pantallas que YA están traducidas no deben volver a
// llevar textos en español escritos a mano. Se comprueba sobre el código real (sin DOM).
// Para añadir una pantalla a esta lista basta con traducirla y moverla desde PENDING a TRANSLATED.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Pantallas/componentes traducidos y verificados (es/en).
const TRANSLATED = [
  'pages/NotFound.jsx',
  'pages/Analizando.jsx',
  'pages/Login.jsx',
  'pages/VoceroHome.jsx',
  'pages/ElegirEscenario.jsx',
  'pages/CheckTecnico.jsx',
  'pages/SesionPractica.jsx',
  'pages/AdminHome.jsx',
  'pages/MaestroHome.jsx',
  'pages/Practicas.jsx',
  'pages/Temas.jsx',
  'pages/Voceros.jsx',
  'pages/EditorTema.jsx',
  'pages/Estilo.jsx',
  'pages/ColaEtiquetado.jsx',
  'pages/Microleccion.jsx',
  'layouts/MainLayout.jsx',
  'components/Pagination.jsx',
  'components/PracticeSteps.jsx',
  'components/ScenarioBrief.jsx',
  'components/SessionVideo.jsx',
  'components/MetricsDashboard.jsx',
  'components/InterviewConfig.jsx',
  'components/RequestsPanel.jsx',
  'components/RequestFormModal.jsx',
  'components/UserFormModal.jsx',
  'components/JobsPanel.jsx',
  'pages/sistema/Usuarios.jsx',
  'pages/sistema/SistemaHome.jsx',
  'pages/sistema/Biblioteca.jsx',
  'pages/sistema/Organizaciones.jsx',
  'pages/MiProgreso.jsx',
  'pages/InformeCoach.jsx',
  'pages/EditorRubrica.jsx',
  'pages/PoliticaRetencion.jsx',
  'pages/sistema/DetalleOrganizacion.jsx',
  'components/ui.jsx',
];

// Pendientes de traducción: se listan aquí para que quede constancia del trabajo que falta.
// (No se comprueban todavía porque fallarían; al traducirlas, moverlas a TRANSLATED.)
const PENDING = [];

// Herramientas internas de laboratorio: NO forman parte del producto final y no se traducen.
// (No se listan en TRANSLATED ni PENDING para no exigirles traducción.)
const LABS = [
  'pages/Laboratorio.jsx',
  'pages/MediaPipeTest.jsx',
  'components/TranscriptionLab.jsx',
  'components/RealtimeLab.jsx',
  'components/NvidiaLab.jsx',
  'components/RecordedComparison.jsx',
];

// Primitivas visuales sin textos propios (iconos y marca): no contienen copia de interfaz, por eso
// no se les exige `useI18n()`. Cualquier texto visible que se añada aquí debe pasar a TRANSLATED.
const PRIMITIVES = ['components/Icon.jsx', 'components/Logo.jsx'];

const ACCENTS = /[áéíóúñ¿¡]/i;

// Los registros de desarrollo (consola) no son textos de interfaz.
const isDevLog = (line) => /console\.(log|warn|error|info)|logMedia\(/.test(line);

// ---------------------------------------------------------------------------
// Detección de texto de interfaz SIN depender de los acentos.
//
// La comprobación por acentos sola no basta: «Eliminar», «Guardar», «Tipo de escenarios»… no llevan
// tilde. Se añade una segunda regla basada en el VOCABULARIO español: un literal visible se marca si
// contiene una palabra de interfaz en español. Para evitar falsos positivos se descartan los
// literales que no pueden ser texto visible (identificadores, rutas, clases CSS, enums, marcas y
// códigos de idioma).
// ---------------------------------------------------------------------------
const SPANISH_WORDS = new Set([
  // Palabras funcionales
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'al', 'del', 'de', 'que', 'para', 'con', 'sin',
  'por', 'se', 'su', 'sus', 'tu', 'tus', 'mi', 'mis', 'no', 'es', 'son', 'como', 'mas', 'más', 'ya',
  'hay', 'puede', 'puedes', 'debe', 'debes', 'solo', 'sólo', 'todo', 'toda', 'todos', 'todas',
  'este', 'esta', 'estos', 'estas', 'otro', 'otra', 'otros', 'otras', 'entre', 'desde', 'hasta',
  // Verbos y acciones de interfaz
  'ver', 'guardar', 'guardando', 'crear', 'creando', 'eliminar', 'eliminando', 'buscar', 'cancelar',
  'aceptar', 'confirmar', 'aplicar', 'aplicando', 'reintentar', 'salir', 'entrar', 'volver', 'cerrar',
  'abrir', 'seleccionar', 'asignar', 'gestionar', 'mostrar', 'escribir', 'hablar', 'escuchar',
  'responder', 'empezar', 'terminar', 'esperar', 'comprobar', 'comprobando', 'preparar', 'preparando',
  'analizar', 'analizando', 'cargar', 'cargando', 'enviar', 'enviando', 'procesar', 'procesando',
  'suspender', 'suspendiendo', 'reactivar', 'calibrar', 'calibrando', 'transcribir', 'transcribiendo',
  'copiar', 'copiando', 'editar', 'exportar', 'descargar', 'subir',
  // Sustantivos y etiquetas del dominio
  'vocero', 'voceros', 'escenario', 'escenarios', 'practica', 'práctica', 'practicas', 'prácticas',
  'usuario', 'usuarios', 'organizacion', 'organización', 'organizaciones', 'tema', 'temas', 'informe',
  'informes', 'sesion', 'sesión', 'sesiones', 'estado', 'activo', 'activa', 'suspendido', 'suspendida',
  'nombre', 'correo', 'contrasena', 'contraseña', 'fecha', 'hora', 'minuto', 'minutos', 'segundo',
  'segundos', 'pregunta', 'preguntas', 'respuesta', 'respuestas', 'idioma', 'etiqueta', 'mensaje',
  'mensajes', 'linea', 'línea', 'lineas', 'líneas', 'area', 'área', 'áreas', 'peso', 'pesos', 'criterio',
  'criterios', 'entrevista', 'entrevistas', 'puntaje', 'puntajes', 'retencion', 'retención', 'grabacion',
  'grabación', 'grabaciones', 'privacidad', 'solicitud', 'solicitudes', 'extension', 'extensión',
  'contenido', 'contexto', 'duracion', 'duración', 'idiomas', 'version', 'versión', 'error', 'nuevo',
  'nueva', 'nuevos', 'nuevas', 'predeterminado', 'predeterminada', 'recomendado', 'recomendada',
  'resultado', 'resultados', 'detalle', 'detalles', 'resumen', 'actividad', 'servicio', 'servicios',
  'proceso', 'procesos', 'almacenamiento', 'borrado', 'limpieza', 'analisis', 'análisis', 'camara',
  'cámara', 'microfono', 'micrófono', 'iluminacion', 'iluminación', 'calibracion', 'calibración',
  'rostro', 'cuerpo', 'postura', 'mirada', 'voz', 'tono', 'empatia', 'empatía', 'coherencia', 'expresion',
  'expresión', 'acuerdo', 'confianza', 'patron', 'patrón', 'patrones', 'rubrica', 'rúbrica', 'cliente',
  'clientes', 'equipo', 'equipos', 'persona', 'personas',
  // Vocabulario administrativo y de estado (sin acentos o con ellos)
  'administrador', 'administradores', 'sector', 'accion', 'acción', 'acciones', 'ultima', 'última', 'ultimo',
  'último', 'primero', 'siguiente', 'anterior', 'asignado', 'asignados', 'disponible', 'disponibles',
  'obligatorio', 'opcional', 'ayuda', 'ejemplo', 'inicio', 'pausado', 'pausada', 'eliminado', 'eliminada',
  'creado', 'creada', 'actualizado', 'actualizada', 'pendiente', 'pendientes', 'revisado', 'revisada',
  'completado', 'completada', 'correcto', 'correcta', 'incorrecto', 'incorrecta', 'necesario', 'necesaria',
  'importante', 'informacion', 'información', 'datos', 'valor', 'valores', 'fila', 'filas', 'columna',
  'columna', 'tabla', 'opcion', 'opción', 'opciones', 'elemento', 'elementos', 'lista', 'listado', 'buscador',
  'filtro', 'filtros', 'rango', 'periodo', 'período', 'mes', 'año', 'semana', 'dia', 'día', 'hoy', 'ayer',
  'promedio', 'maximo', 'máximo', 'minimo', 'mínimo', 'nivel', 'niveles', 'nota', 'acceso', 'cuenta', 'cuentas',
  'rol', 'roles', 'permiso', 'permisos', 'notificacion', 'notificación', 'aviso', 'exito', 'éxito', 'advertencia',
  'confirmacion', 'confirmación', 'continuar', 'finalizar', 'comenzar', 'iniciar', 'detener', 'actualizar',
  'refrescar', 'descartar', 'ocultar', 'activar', 'desactivar', 'habilitar', 'deshabilitar', 'pausar',
  'reanudar', 'generando', 'calculando', 'evaluando', 'revisando', 'validando', 'registrando', 'finalizando',
]);

// Literales legítimos en su idioma original (marcas, tecnologías, códigos de idioma, unidades).
const IGNORED_LITERALS = new Set([
  'VoxReady', 'Español', 'English', 'es', 'en', 'pt', 'fr', 'ms', 'min', 'h', 'MB', 'REC',
  'NVIDIA', 'MediaPipe', 'PostgreSQL', 'Prisma', 'Express', 'Chrome', 'Edge', 'YouTube', 'Retail',
]);

// ¿El literal no puede ser texto visible? (identificadores, rutas, clases, enums, plantillas)
const notVisibleText = (value) => {
  if (!value || value.length < 3) return true;
  if (IGNORED_LITERALS.has(value)) return true;
  if (/[-_/:@#%{}()[\]<>*|=+\\$"`~^;]/.test(value)) return true; // clases, rutas, claves, plantillas
  if (/^[\w$]+(\.[\w$]+)+$/.test(value)) return true; // identificador punteado (a.b.c)
  if (/^[A-Z0-9_\s]+$/.test(value)) return true; // enums y constantes en mayúsculas
  if (/^[a-z]+[A-Z]/.test(value)) return true; // camelCase (identificadores)
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(value)) return true;
  return false;
};

// ¿Contiene alguna palabra del vocabulario español de interfaz?
const hasSpanishWord = (value) => {
  const tokens = value.toLowerCase().match(/[a-záéíóúñü]+/g) || [];
  return tokens.some((token) => SPANISH_WORDS.has(token));
};

// Valores internos del código (no son texto de interfaz): claves de API/URL, modos y roles
// internos de la transcripción. Se listan explícitamente para no debilitar la detección.
const INTERNAL_LITERALS = new Set(['vocero', 'voz', 'texto', 'nuevo']);

// Propiedades cuyo valor es un identificador interno, no un texto visible.
const INTERNAL_KEY = /(^|[\s,{[(])(role|type|kind|mode|key|scope|status|category|field|name|id|variant|tone|icon|ref|as|method)\s*:\s*$/;
// Funciones cuyos argumentos son claves (URL, objetos, índices), no textos.
const KEY_CALL = /(\bget|\bset|\bhas|\bdelete|\bindexOf|\bincludes|\bstartsWith|\bendsWith|\bcreateElement|\baddEventListener|\bremoveEventListener)\(\s*$/;
// Comparación contra un valor interno: `x.state === 'error'`, `p.tone !== 'danger'`… El literal que
// está JUSTO a la derecha de un operador de comparación es un código interno, nunca texto visible.
// (Un texto de interfaz nunca se escribe comparando contra él; se escribe como valor a mostrar.)
const ENUM_COMPARE = /[\w.$[\]'"]+\s*(===|!==|==|!=)\s*$/;

// Texto visible de una línea: cadenas entre comillas (simples, dobles y plantillas) y texto entre
// etiquetas JSX. `text` quita las interpolaciones `${…}` para evaluar solo el texto estático.
function visibleLiterals(line) {
  const out = [];
  const pattern = /'([^'\n]{2,})'|"([^"\n]{2,})"|`([^`\n]{2,})`|>\s*([A-Za-zÁÉÍÓÚÑáéíóúñ][^<>{}\n]{2,})\s*</g;
  for (const match of line.matchAll(pattern)) {
    const raw = String(match[1] ?? match[2] ?? match[3] ?? match[4] ?? '');
    const value = raw.trim();
    const quoted = match[1] !== undefined || match[2] !== undefined || match[3] !== undefined;
    out.push({ value, text: value.replace(/\$\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim(), index: match.index, quoted });
  }
  return out;
}

// ¿El literal es un identificador interno (clave de API, valor de enum, argumento técnico)?
function isInternalLiteral(line, { text, index, quoted }) {
  if (!quoted) return false; // el texto JSX siempre es visible
  if (INTERNAL_LITERALS.has(text)) return true;
  const before = line.slice(0, index);
  if (KEY_CALL.test(before)) return true;
  if (INTERNAL_KEY.test(before)) return true;
  if (ENUM_COMPARE.test(before)) return true;
  return false;
}

test('la lista de pantallas pendientes no incluye ninguna ya traducida', () => {
  const overlap = TRANSLATED.filter((file) => PENDING.includes(file));
  assert.deepEqual(overlap, [], 'una pantalla no puede estar traducida y pendiente a la vez');
});

test('todas las pantallas del producto están clasificadas (traducidas o pendientes)', () => {
  // Evita que una pantalla nueva quede fuera de las listas y, por tanto, sin comprobar.
  const dirs = ['pages', 'components', 'layouts'];
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.jsx')) found.push(rel);
    }
  };
  for (const dir of dirs) walk(dir);
  const known = [...TRANSLATED, ...PENDING, ...LABS, ...PRIMITIVES];
  const unknown = found.filter((file) => !known.includes(file));
  assert.deepEqual(unknown, [], 'estas pantallas no están en TRANSLATED, PENDING ni LABS');
});

test('las pantallas traducidas resuelven sus textos desde el diccionario', () => {
  for (const file of TRANSLATED) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /useI18n\(\)/, `${file} debe usar el diccionario`);
  }
});

test('las pantallas traducidas no contienen textos de interfaz escritos a mano (acentos o vocabulario)', () => {
  const suspects = [];
  for (const file of TRANSLATED) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const lines = source
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*/, '')) // los comentarios no son textos de interfaz
      .filter((line) => !line.trim().startsWith('*'))
      .filter((line) => !line.trim().startsWith('{/*'))
      .filter((line) => !isDevLog(line));
    for (const line of lines) {
      for (const literal of visibleLiterals(line)) {
        const { text } = literal;
        if (notVisibleText(text)) continue;
        if (isInternalLiteral(line, literal)) continue;
        if (!ACCENTS.test(text) && !hasSpanishWord(text)) continue;
        suspects.push(`${file}: ${text}`);
      }
    }
  }
  assert.deepEqual(suspects, [], `textos sin traducir:\n${suspects.join('\n')}`);
});

test('el detector de vocabulario reconoce español sin acentos y no marca identificadores', () => {
  // La regla nueva debe cazar lo que la comprobación por acentos dejaba pasar…
  assert.ok(hasSpanishWord('Eliminar'), 'una palabra de interfaz sin acentos se detecta');
  assert.ok(hasSpanishWord('Tipo de escenarios'), 'una frase sin acentos se detecta');
  assert.ok(hasSpanishWord('Guardando cambios'), 'un gerundio de interfaz se detecta');
  // …y no debe marcar literales que no son texto visible ni identificadores internos.
  for (const value of ['text-ink', '/admin/voceros', 'voxready_token', 'ACTIVE', 'tenantId', 'VoxReady', 'w-full', 'REC']) {
    assert.ok(notVisibleText(value), `«${value}» no es texto visible`);
  }
  const paramsLine = "const sessionId = payload?.sessionId || params.get('sesion') || null;";
  const [paramLiteral] = visibleLiterals(paramsLine);
  assert.ok(isInternalLiteral(paramsLine, paramLiteral), 'la clave de un query param no es texto visible');
  const roleLine = "  role: 'vocero',";
  const [roleLiteral] = visibleLiterals(roleLine);
  assert.ok(isInternalLiteral(roleLine, roleLiteral), 'el valor de un rol interno no es texto visible');
  const labelLine = "  title: 'Estado del sistema',";
  const [labelLiteral] = visibleLiterals(labelLine);
  assert.equal(isInternalLiteral(labelLine, labelLiteral), false, 'una etiqueta visible sí se revisa');
  // Comparación contra un valor interno: el literal de la derecha es un código, no texto visible.
  const stateLine = "tone={access.state === 'error' || access.state === 'failed' ? 'danger' : undefined}";
  const [stateLiteral] = visibleLiterals(stateLine);
  assert.ok(isInternalLiteral(stateLine, stateLiteral), 'el valor de un estado interno no es texto visible');
  const toneLine = "  <Badge tone={turn.metrics?.fillers ? 'warning' : 'outline'}>";
  const [toneLiteral] = visibleLiterals(toneLine);
  assert.ok(
    !ACCENTS.test(toneLiteral.text) && !hasSpanishWord(toneLiteral.text),
    'un tono interno en inglés no se marca como texto en español',
  );
  // Un texto de interfaz sigue detectándose aunque esté en una expresión ternaria.
  const ternaryLine = "{loading ? 'Cargando…' : 'Guardar cambios'}";
  const ternaryLiterals = visibleLiterals(ternaryLine);
  assert.ok(
    ternaryLiterals.every((literal) => !isInternalLiteral(ternaryLine, literal)),
    'los textos de una expresión ternaria sí se revisan',
  );
  assert.equal(hasSpanishWord('Apply retention'), false, 'el inglés no se marca por vocabulario');
});

test('el detector no es vacuo: encuentra texto hardcodeado en un fragmento real', () => {
  // Fragmento equivalente a una pantalla sin traducir: el detector debe señalar sus textos.
  const sample = [
    '        eyebrow="Administración del sistema"',
    "        title=\"Usuarios\"",
    "        description=\"Todas las cuentas de la plataforma.\"",
    '        actions={<Button icon="plus">Nuevo usuario</Button>}',
  ].join('\n');
  const found = sample
    .split('\n')
    .flatMap((line) => visibleLiterals(line))
    .map((literal) => literal.value)
    .filter((value) => !notVisibleText(value) && (ACCENTS.test(value) || hasSpanishWord(value)));
  assert.deepEqual(found, [
    'Administración del sistema',
    'Usuarios',
    'Todas las cuentas de la plataforma.',
    'Nuevo usuario',
  ]);
});

test('los laboratorios no se exigen traducidos (quedan fuera de las listas)', () => {
  for (const file of LABS) {
    assert.equal(TRANSLATED.includes(file), false, `${file} es una herramienta interna`);
    assert.equal(PENDING.includes(file), false, `${file} es una herramienta interna`);
  }
});

