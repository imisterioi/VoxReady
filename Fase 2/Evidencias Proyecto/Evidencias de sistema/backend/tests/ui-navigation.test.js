// Comprobación ESTÁTICA de la interfaz: navegación por tarjetas, formulario único de solicitudes
// y efecto de borde de las tarjetas de organizaciones.
//
// No es una prueba de navegador: lee el código de las pantallas y verifica que se cumplen las
// condiciones pedidas. La comprobación visual (cursor, foco, clics) queda para revisión manual.
//
// Uso:  node tests/ui-navigation.test.js
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'frontend', 'src');
const read = (relative) => fs.readFileSync(path.join(src, relative), 'utf8');

const organizaciones = read(path.join('pages', 'sistema', 'Organizaciones.jsx'));
const voceros = read(path.join('pages', 'Voceros.jsx'));
const detalleSistema = read(path.join('pages', 'sistema', 'DetalleOrganizacion.jsx'));
const retencionCliente = read(path.join('pages', 'PoliticaRetencion.jsx'));
const formulario = read(path.join('components', 'RequestFormModal.jsx'));
const reglasFormulario = read(path.join('lib', 'requestForm.js'));
const app = read('App.jsx');

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass += 1;
    console.log('  \u2713', msg);
  } else {
    fail += 1;
    console.log('  \u2717', msg);
  }
};
const count = (source, token) => source.split(token).length - 1;

console.log('\n1) Tarjetas de organizaciones: navegación');
ok(/role="link"/.test(organizaciones), 'la tarjeta se anuncia como enlace');
ok(/tabIndex=\{0\}/.test(organizaciones), 'la tarjeta recibe foco con el teclado');
ok(/aria-label=\{`Ver el detalle de/.test(organizaciones), 'la tarjeta tiene una etiqueta accesible');
ok(/onKeyDown=/.test(organizaciones), 'la tarjeta responde a Enter/Espacio');
ok(/navigate\(`\/sistema\/organizaciones\/\$\{tenant\.id\}`\)/.test(organizaciones), 'navega a la ruta de detalle existente');
ok(/sistema\/organizaciones\/:id/.test(app), 'la ruta del detalle no cambió');
ok(!/>\s*Detalle\s*</.test(organizaciones), 'no existe el botón «Detalle»');
ok(/>\s*Admin\s*</.test(organizaciones) && /Suspender/.test(organizaciones) && /Eliminar/.test(organizaciones), 'las acciones internas de la tarjeta se conservan');
ok(/closest\('a, button'\)/.test(organizaciones), 'los botones internos no disparan la navegación');

console.log('\n2) Tarjetas de organizaciones: borde claro un poco más grueso, sin brillos');
ok(/hover:border-line-strong/.test(organizaciones), 'al pasar el cursor el borde adopta un color claro');
ok(/after:border\b/.test(organizaciones) && /after:inset-0/.test(organizaciones), 'el grosor se dibuja con un borde interior reservado');
ok(/after:opacity-0/.test(organizaciones) && /hover:after:opacity-100/.test(organizaciones), 'el borde interior aparece solo al pasar el cursor');
ok(/after:pointer-events-none/.test(organizaciones), 'el borde reservado no intercepta los clics');
ok(/after:rounded-2xl/.test(organizaciones), 'el borde interior respeta el redondeo de la tarjeta');
ok(/transition-colors/.test(organizaciones) && /after:transition-opacity/.test(organizaciones), 'la transición es suave en el color y en el grosor');
ok(!/hover:shadow/.test(organizaciones) && !/hover:ring/.test(organizaciones), 'no hay sombras ni resplandores al pasar el cursor');
ok(/focus-visible:ring-/.test(organizaciones), 'el indicador de teclado se mantiene (solo con el foco)');

console.log('\n3) Tarjetas de voceros: efecto sin cambios');
ok(/hover:bg-subtle\/60/.test(voceros), 'conserva el cambio sutil de fondo');
ok(!/hover:border-line-strong/.test(voceros), 'no ilumina el borde');
ok(!/after:border\b/.test(voceros), 'no usa el borde reservado de organizaciones');
ok(/<Link[\s\S]{0,200}to=\{`\/admin\/vocero\/\$\{u\.id\}`\}/.test(voceros), 'el nombre sigue siendo un enlace a la ruta de progreso');
ok(/focus-within:bg-subtle/.test(voceros), 'el indicador de teclado se mantiene');
ok(!/>\s*Progreso\s*</.test(voceros), 'no existe el botón «Progreso»');
ok(/admin\/vocero\/:userId/.test(app), 'la ruta del progreso no cambió');

console.log('\n4) Solicitudes del administrador del cliente: un solo botón y formulario dinámico');
ok(count(retencionCliente, 'Nueva solicitud') === 1, 'hay un único botón principal «Nueva solicitud»');
ok(!retencionCliente.includes('Solicitar extensión<'), 'ya no hay un botón aparte para la extensión');
ok(!retencionCliente.includes('title="Nueva solicitud de borrado"'), 'ya no hay un formulario fijo de privacidad');
ok(!retencionCliente.includes('Solicitud de extensión del plazo de conservación'), 'ya no hay un formulario fijo de extensión');
ok(retencionCliente.includes('RequestFormModal') && retencionCliente.includes('onSubmit={createRequest}'), 'la creación usa el formulario único');
ok(/<select/.test(formulario), 'el formulario permite elegir el tipo de solicitud');
ok(/type\.kind === 'privacy' \?/.test(formulario), 'los campos cambian según el tipo elegido');
ok(/switchRequestType/.test(formulario), 'al cambiar de tipo se descartan los campos del tipo anterior');
ok(/validateRequestForm/.test(formulario) && /buildRequestPayload/.test(formulario), 'valida y construye el cuerpo con las reglas del backend');
ok(/voceros\.map/.test(formulario), 'el tipo de privacidad pide el vocero');
ok(/Plazo solicitado/.test(formulario), 'el tipo de extensión pide el plazo solicitado');
ok(/Motivo/.test(formulario), 'el motivo está disponible donde corresponde');
ok(/Cancelar/.test(formulario), 'hay botón para cancelar sin crear nada');

console.log('\n5) Tipos de solicitud reales y permisos');
ok(/RECORDINGS/.test(reglasFormulario) && /ANONYMIZE/.test(reglasFormulario), 'se usan los alcances de privacidad que admite el backend');
ok(/'\/api\/deletion-requests'/.test(reglasFormulario), 'las solicitudes de privacidad van a su endpoint real');
ok(/'\/api\/retention-requests'/.test(reglasFormulario), 'las extensiones van a su endpoint real');
ok(/RETENTION_EXTENSION/.test(reglasFormulario), 'la extensión de retención es un tipo propio');
ok(!/INVENTADO|SIMULADO/.test(reglasFormulario), 'no se inventan tipos de solicitud');
ok(!/method: 'PATCH'[\s\S]{0,80}retention-requests/.test(retencionCliente), 'el administrador del cliente no resuelve extensiones');
ok(!/method: 'PATCH'[\s\S]{0,80}deletion-requests/.test(retencionCliente), 'el administrador del cliente no resuelve solicitudes de privacidad');
ok(detalleSistema.includes('resolvePrivacy') && detalleSistema.includes('resolveExtension'), 'el administrador del sistema conserva las acciones de resolución');

console.log('\n6) Panel único de solicitudes (ambos perfiles)');
for (const [nombre, source] of [['administrador del sistema', detalleSistema], ['administrador del cliente', retencionCliente]]) {
  ok(count(source, '<RequestsPanel') === 1, `${nombre}: un único contenedor de solicitudes`);
  ok(!source.includes('title="Solicitudes de privacidad"') && !source.includes('title="Solicitudes de extensión'), `${nombre}: sin contenedores separados por tipo`);
  ok(source.includes('buildRequestsFeed'), `${nombre}: los tipos se juntan en una sola lista`);
  ok(source.includes('onOpen={openRequestDetail}'), `${nombre}: las solicitudes se pueden abrir`);
  ok(source.includes('/api/deletion-requests') && source.includes('/api/retention-requests'), `${nombre}: sigue leyendo ambos tipos`);
}

console.log(`\nResultado: ${pass} aprobadas, ${fail} fallidas.`);
process.exitCode = fail === 0 ? 0 : 1;

