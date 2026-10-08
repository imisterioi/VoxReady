// Evaluador del modo demostración. Replica el informe de backend/ai/evaluator.js:
//  - Tono de voz y Expresión usan las MISMAS reglas que el backend (métricas medidas).
//  - Coherencia y Empatía, que en producción juzga la IA (API de NVIDIA), aquí se
//    estiman con reglas simples sobre la transcripción (palabras clave, mensajes
//    clave cubiertos, líneas rojas). Así la demo funciona sin backend ni API key.
import { parseList, resolveConfig } from './patternConfig';

const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const round = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

function rangeScore(value, idealMin, idealMax, zeroBelow, zeroAbove) {
  if (value == null || Number.isNaN(value)) return null;
  if (value >= idealMin && value <= idealMax) return 100;
  if (value < idealMin) return clamp(((value - zeroBelow) / Math.max(idealMin - zeroBelow, 1e-9)) * 100);
  return clamp(((zeroAbove - value) / Math.max(zeroAbove - idealMax, 1e-9)) * 100);
}

const average = (items) => {
  const valid = items.filter((i) => i.score != null && i.weight > 0);
  const total = valid.reduce((s, i) => s + i.weight, 0);
  return total ? valid.reduce((s, i) => s + i.score * i.weight, 0) / total : null;
};

// ------------------------------------------------------ Tono de voz (reglas)

function scoreVoice(voice = {}, cfg) {
  if (!voice?.available) return { score: null, details: [] };
  const c = cfg.voice.criteria;
  const wpmMin = num(c.wpm.idealMin, 120);
  const wpmMax = num(c.wpm.idealMax, 165);
  const fillerTol = num(c.fillers.tolerancePerMin, 2);
  const pauseTol = num(c.pauses.tolerancePerAnswer, 1);
  const varMin = num(c.variation.idealMin, 35) / 100;
  const varMax = num(c.variation.idealMax, 90) / 100;
  const latMax = num(c.latency.idealMaxSec, 2.5) * 1000;

  const details = [
    { key: 'wpm', label: c.wpm.label, value: round(voice.wpm), unit: 'palabras/min', weight: num(c.wpm.weight, 0), score: rangeScore(voice.wpm, wpmMin, wpmMax, wpmMin * 0.5, wpmMax * 1.4) },
    {
      key: 'fillers',
      label: c.fillers.label,
      value: voice.fillersPerMin != null ? Number(voice.fillersPerMin.toFixed(1)) : null,
      unit: 'por minuto',
      weight: num(c.fillers.weight, 0),
      score: voice.fillersPerMin == null ? null : clamp(100 - Math.max(0, voice.fillersPerMin - fillerTol) * 12),
    },
    {
      key: 'pauses',
      label: c.pauses.label,
      value: voice.longPauses,
      unit: 'en total',
      weight: num(c.pauses.weight, 0),
      score: voice.longPausesPerAnswer == null ? null : clamp(100 - Math.max(0, voice.longPausesPerAnswer - pauseTol) * 20),
    },
    {
      key: 'variation',
      label: c.variation.label,
      value: voice.volumeVariation != null ? round(voice.volumeVariation * 100) : null,
      unit: '%',
      weight: num(c.variation.weight, 0),
      score: rangeScore(voice.volumeVariation, varMin, varMax, varMin * 0.3, varMax * 1.7),
    },
    {
      key: 'latency',
      label: c.latency.label,
      value: voice.avgLatencyMs != null ? Number((voice.avgLatencyMs / 1000).toFixed(1)) : null,
      unit: 's',
      weight: num(c.latency.weight, 0),
      score: rangeScore(voice.avgLatencyMs, 300, latMax, 0, latMax * 3),
    },
  ];
  return { score: round(average(details)), details };
}

// ------------------------------------------------ Expresión corporal (reglas)

function scoreBody(body = {}, cfg) {
  if (!body?.available) return { score: null, details: [] };
  const c = cfg.expression.criteria;
  const presenceMin = num(c.presence.idealMinPct, 90) / 100;
  const facingMin = num(c.facing.idealMinPct, 75) / 100;
  const tiltMax = num(c.posture.idealMaxDeg, 4);

  const details = [
    { key: 'presence', label: c.presence.label, value: round(body.presence * 100), unit: '%', weight: num(c.presence.weight, 0), score: rangeScore(body.presence, presenceMin, 1, presenceMin * 0.3, 2) },
    { key: 'facing', label: c.facing.label, value: round(body.facingCamera * 100), unit: '%', weight: num(c.facing.weight, 0), score: rangeScore(body.facingCamera, facingMin, 1, facingMin * 0.25, 2) },
    { key: 'posture', label: c.posture.label, value: body.shoulderTilt != null ? Number(body.shoulderTilt.toFixed(1)) : null, unit: '°', weight: num(c.posture.weight, 0), score: rangeScore(body.shoulderTilt, 0, tiltMax, 0, tiltMax * 4) },
    { key: 'head', label: c.head.label, value: body.headMovement != null ? Number((body.headMovement * 1000).toFixed(1)) : null, unit: 'mov.', weight: num(c.head.weight, 0), score: rangeScore(body.headMovement, 0.001, 0.006, 0, 0.02) },
    { key: 'hands', label: c.hands.label, value: body.handActivity != null ? Number((body.handActivity * 1000).toFixed(1)) : null, unit: 'mov.', weight: num(c.hands.weight, 0), score: rangeScore(body.handActivity, 0.002, 0.012, 0, 0.035) },
  ];
  return { score: round(average(details)), details };
}

// ------------------------------------------- Contenido (reglas de la demo)

const normalize = (s = '') =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const STOPWORDS = new Set(
  'para porque sobre entre desde hasta como cuando donde nuestro nuestra nuestros nuestras todos todas este esta estos estas ellos ellas tambien pero sino aunque menos mucho mucha muchos muchas cada otro otra otros otras sera seran esta estan hemos hacer hace tiene tienen forma manera debe deben quiere'.split(
    ' ',
  ),
);

const keywords = (text) => [...new Set(normalize(text).match(/[a-zñ0-9%]{5,}/g) || [])].filter((w) => !STOPWORDS.has(w));

const EMPATHY_WORDS = ['lament', 'sentimos', 'disculp', 'perdon', 'entiendo', 'comprendo', 'familias', 'personas', 'afectad', 'pacientes', 'vecinos', 'preocupacion', 'molestia', 'angustia', 'acompan'];
const WARMTH_WORDS = ['entiendo', 'comprendo', 'sabemos lo', 'imagino', 'gracias', 'paciencia', 'cercania', 'acompan', 'escuchar', 'de verdad'];
const RESPONSIBILITY_WORDS = ['asumimos', 'responsabilidad', 'nos hacemos cargo', 'fue un error', 'nuestro error', 'reconocemos', 'compromiso', 'nos comprometemos', 'compensar', 'compensaremos', 'vamos a revisar', 'revisaremos'];
const BLAME_WORDS = ['culpa de', 'culpa del', 'el clima', 'terceros', 'los clientes no', 'no es nuestra culpa', 'no fue nuestra culpa'];
const MINIMIZE_WORDS = ['no fue tan grave', 'no es tan grave', 'exagerad', 'no es para tanto', 'fue menor', 'nada grave'];
const PROMISE_WORDS = ['le garantizo', 'te garantizo', 'garantizamos', 'prometo', 'le aseguro que manana', 'en 24 horas esta todo', 'nunca mas va a pasar'];

const countHits = (text, list) => list.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);

// Busca la frase del vocero que contiene alguna de las palabras indicadas
function evidenceFor(transcript, list) {
  for (const turn of transcript) {
    const answer = turn.answer || '';
    const sentences = answer.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      if (list.some((w) => normalize(s).includes(w))) return s.trim();
    }
  }
  return '';
}

function judgeContent({ theme, transcript, voice, body, cfg }) {
  const keyMessages = parseList(theme?.keyMessages);
  const redLines = parseList(theme?.redLines);
  const answers = transcript.map((t) => t.answer || '');
  const all = normalize(answers.join(' '));
  const words = all.split(/\s+/).filter(Boolean).length;
  const answered = answers.filter((a) => a.trim().split(/\s+/).length >= 6).length;
  const shift = cfg.strictness === 'exigente' ? -8 : cfg.strictness === 'flexible' ? 6 : 0;

  // Mensajes clave: cubierto si aparecen varias de sus palabras importantes
  const mensajesClave = keyMessages.map((m) => {
    const kw = keywords(m);
    const hits = kw.filter((w) => all.includes(w.slice(0, Math.max(5, w.length - 2)))).length;
    return { mensaje: m, cubierto: kw.length ? hits / kw.length >= 0.3 || hits >= 3 : false };
  });

  // Líneas rojas: se detectan frases típicas de culpar, minimizar o prometer
  const lineasRojas = redLines.map((l) => {
    const nl = normalize(l);
    const list = /culp|terceros|clima/.test(nl)
      ? BLAME_WORDS
      : /minimiz|grave/.test(nl)
        ? MINIMIZE_WORDS
        : /promet|plazo|monto|garantiz/.test(nl)
          ? PROMISE_WORDS
          : [];
    const evidencia = list.length ? evidenceFor(transcript, list) : '';
    return { linea: l, cruzada: Boolean(evidencia), evidencia };
  });
  const crossed = lineasRojas.filter((l) => l.cruzada).length;

  const covered = mensajesClave.filter((m) => m.cubierto).length;
  const coverage = keyMessages.length ? covered / keyMessages.length : answered / Math.max(transcript.length, 1);
  const avgWords = transcript.length ? words / transcript.length : 0;
  const fillersPerMin = voice?.available ? voice.fillersPerMin || 0 : 2;

  const empathyHits = countHits(all, EMPATHY_WORDS);
  const warmthHits = countHits(all, WARMTH_WORDS);
  const responsibilityHits = countHits(all, RESPONSIBILITY_WORDS);
  const blamed = countHits(all, BLAME_WORDS) > 0;

  const coherencia = {
    keyMessages: clamp(Math.round(35 + coverage * 60 + shift)),
    directness: clamp(Math.round((avgWords < 10 ? 40 : avgWords < 25 ? 62 : avgWords <= 130 ? 84 : 70) + (answered / Math.max(transcript.length, 1) - 1) * 30 + shift)),
    redLines: clamp(100 - crossed * 38 + Math.min(shift, 0)),
    clarity: clamp(Math.round(88 - Math.max(0, fillersPerMin - 2) * 6 - (avgWords > 140 ? 12 : 0) + shift)),
  };
  const empatia = {
    impact: clamp(Math.round(38 + empathyHits * 11 + shift)),
    warmth: clamp(Math.round(48 + warmthHits * 10 + (body?.available ? (body.facingCamera - 0.6) * 30 : 0) + shift)),
    responsibility: clamp(Math.round(40 + responsibilityHits * 13 - (blamed ? 25 : 0) + shift)),
  };

  // ------------------------------------------------ Textos del coach
  const fortalezas = [];
  const mejoras = [];
  if (coverage >= 0.6) fortalezas.push(`Sostuviste ${covered} de ${keyMessages.length} mensajes clave, incluso cuando el periodista presionó.`);
  else if (keyMessages.length) mejoras.push(`Solo cubriste ${covered} de ${keyMessages.length} mensajes clave: usa frases puente ("lo importante aquí es…") para volver a ellos.`);
  if (empathyHits >= 2) fortalezas.push('Reconociste el impacto en las personas afectadas antes de entrar en los datos técnicos.');
  else mejoras.push('Empieza tus respuestas reconociendo a las personas afectadas; luego entrega los datos.');
  if (responsibilityHits >= 1 && !blamed) fortalezas.push('Asumiste responsabilidad y comprometiste acciones concretas.');
  else mejoras.push('Asume la responsabilidad de la organización y evita trasladar la culpa a terceros.');
  if (crossed === 0 && redLines.length) fortalezas.push('No cruzaste ninguna línea roja del escenario.');
  else if (crossed) mejoras.push(`Cruzaste ${crossed} línea(s) roja(s): prepara de antemano qué responder cuando te tienten a hacerlo.`);
  if (voice?.available) {
    if (voice.fillersPerMin > 3) mejoras.push(`Reduce las muletillas (${voice.fillersPerMin.toFixed(1)} por minuto): una pausa breve comunica más seguridad que un "eh".`);
    else fortalezas.push('Hablaste con fluidez y casi sin muletillas.');
  }
  if (body?.available) {
    if (body.facingCamera < 0.7) mejoras.push(`Mantén la mirada en la cámara: solo la sostuviste el ${Math.round(body.facingCamera * 100)}% del tiempo.`);
    else fortalezas.push(`Mantuviste la mirada en cámara el ${Math.round(body.facingCamera * 100)}% del tiempo, lo que transmite confianza.`);
  }
  if (fortalezas.length === 0) fortalezas.push('Completaste la entrevista sin abandonar, lo que ya es un buen punto de partida.');
  if (mejoras.length === 0) mejoras.push('Practica un escenario de mayor presión para seguir subiendo tu nivel.');

  const avgCoh = (coherencia.keyMessages + coherencia.directness + coherencia.redLines + coherencia.clarity) / 4;
  const avgEmp = (empatia.impact + empatia.warmth + empatia.responsibility) / 3;
  const level = (v) => (v >= 75 ? 'sólida' : v >= 55 ? 'correcta, con margen de mejora' : 'todavía débil');
  const resumen = `Tu coherencia fue ${level(avgCoh)} y tu empatía ${level(avgEmp)}. ${
    crossed ? 'El punto más urgente es no volver a cruzar las líneas rojas del escenario.' : coverage >= 0.6 ? 'Mantuviste el foco en lo que la organización necesitaba comunicar.' : 'Te faltó volver a tus mensajes clave cuando te presionaron.'
  }`;

  let cita;
  if (body?.available && body.facingCamera < 0.7 && empathyHits >= 2) {
    cita = 'Tus palabras mostraron empatía, pero al hablar de las personas afectadas desviaste la mirada: eso resta credibilidad a lo que dices.';
  } else if (voice?.available && voice.fillersPerMin > 3 && coverage >= 0.5) {
    cita = 'Tenías claros tus mensajes, pero las muletillas en las preguntas difíciles hicieron que sonaras menos seguro de lo que realmente estabas.';
  } else if (crossed) {
    cita = `Cuando dijiste "${lineasRojas.find((l) => l.cruzada)?.evidencia}", el titular de mañana ya estaba escrito. Ese tipo de frase es la que el periodista busca.`;
  } else if (avgEmp >= 70 && avgCoh >= 70) {
    cita = 'Sonaste firme con los datos y humano con las personas: esa combinación es exactamente la que genera confianza en una crisis.';
  } else {
    cita = 'Respondiste las preguntas, pero sin una idea fuerza que se repita: elige una frase clave y vuelve a ella en cada respuesta.';
  }

  const porPregunta = transcript.map((turn, i) => {
    const a = normalize(turn.answer || '');
    const len = a.split(/\s+/).filter(Boolean).length;
    const emp = countHits(a, EMPATHY_WORDS);
    const red = countHits(a, [...BLAME_WORDS, ...MINIMIZE_WORDS, ...PROMISE_WORDS]);
    const kmHit = mensajesClave.some((m) => keywords(m.mensaje).filter((w) => a.includes(w.slice(0, Math.max(5, w.length - 2)))).length >= 2);
    const score = clamp(Math.round((len < 6 ? 30 : len < 20 ? 55 : 72) + emp * 6 + (kmHit ? 12 : 0) - red * 25 + shift));
    const comentario =
      len < 6
        ? 'Respuesta demasiado breve: el periodista se queda sin tu versión de los hechos.'
        : red
          ? 'Aquí cruzaste una línea roja; reformula sin culpar, minimizar ni prometer lo que no está confirmado.'
          : kmHit && emp
            ? 'Buena respuesta: combinaste un mensaje clave con reconocimiento a los afectados.'
            : kmHit
              ? 'Sostuviste un mensaje clave; agrégale una frase de empatía al inicio.'
              : 'Respondiste, pero sin volver a tus mensajes clave.';
    return { pregunta: i + 1, puntaje: score, comentario };
  });

  return {
    judgement: { coherencia, empatia, resumen, cita, fortalezas: fortalezas.slice(0, 3), mejoras: mejoras.slice(0, 3), mensajesClave, lineasRojas, porPregunta },
    model: 'Evaluador de demostración',
    ms: 1800 + Math.round(Math.random() * 1200),
  };
}

function scoreFromCriteria(area, judged) {
  const details = Object.entries(area.criteria)
    .filter(([, c]) => num(c.weight, 0) > 0)
    .map(([key, c]) => ({
      key,
      label: c.label,
      value: judged?.[key] != null ? round(clamp(Number(judged[key]))) : null,
      unit: '/100',
      weight: num(c.weight, 0),
      score: judged?.[key] != null ? clamp(Number(judged[key])) : null,
    }));
  return { score: average(details), details };
}

// ------------------------------------- Análisis de sensibilidad del video
// Mismo formato que el backend (ai/evaluator.js): cuánto miró a la cámara, cuánto a otro
// lado y cuánto se rió. La coherencia de la risa, que en producción juzga la IA, aquí se
// estima con una regla: reír en un escenario de crisis está fuera de lugar.

const MIN_SMILE_SECONDS = 1;
const seconds = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : null);

function judgeSmile(theme, transcript) {
  const turns = transcript.map((t, i) => ({ n: i + 1, smile: num(t?.metrics?.video?.smileSeconds, 0) })).filter((t) => t.smile >= 0.5);
  const where = turns.length ? `en la${turns.length > 1 ? 's' : ''} pregunta${turns.length > 1 ? 's' : ''} ${turns.map((t) => t.n).join(', ')}` : 'durante la entrevista';
  return theme?.category === 'CRISIS'
    ? { consistencia: 25, comentario: `Sonreíste o reíste ${where}: en un escenario de crisis, con personas afectadas, eso se percibe como falta de empatía.` }
    : { consistencia: 75, comentario: `Sonreíste o reíste ${where}; en este tipo de escenario una sonrisa breve transmite cercanía, siempre que no coincida con un tema delicado.` };
}

function buildSensitivity(body, transcript, theme) {
  if (!body?.available || body.analyzedSeconds == null) return null;
  const total = num(body.analyzedSeconds, 0);
  const pct = (v) => (total > 0 && v != null ? round(clamp((v / total) * 100)) : null);
  const facing = seconds(body.facingSeconds);
  const away = seconds(body.awaySeconds);
  const smile = body.faceAvailable ? seconds(body.smileSeconds) : null;

  let risa = null; // null = no se pudo medir (sin detección de rostro)
  if (smile != null) risa = smile >= MIN_SMILE_SECONDS ? { detectada: true, ...judgeSmile(theme, transcript) } : { detectada: false, consistencia: null, comentario: '' };

  return {
    totalSeconds: seconds(total),
    facingSeconds: facing,
    awaySeconds: away,
    smileSeconds: smile,
    facingPct: pct(facing),
    awayPct: pct(away),
    smilePct: pct(smile),
    risa,
    porPregunta: transcript
      .map((t, i) =>
        t?.metrics?.video
          ? {
              pregunta: i + 1,
              facingSeconds: seconds(t.metrics.video.facingSeconds),
              awaySeconds: seconds(t.metrics.video.awaySeconds),
              smileSeconds: body.faceAvailable ? seconds(t.metrics.video.smileSeconds) : null,
            }
          : null,
      )
      .filter(Boolean),
  };
}

// ------------------------------------------------------ Informe completo

export function evaluateSession({ theme, transcript, metrics, pattern, patternSource = 'active', at = new Date() }) {
  const cfg = resolveConfig(pattern);
  const voice = scoreVoice(metrics?.voice, cfg);
  const body = scoreBody(metrics?.body, cfg);
  const { judgement, model, ms } = judgeContent({ theme, transcript, voice: metrics?.voice, body: metrics?.body, cfg });

  const coherence = scoreFromCriteria(cfg.coherence, judgement.coherencia);
  const empathyContent = scoreFromCriteria(cfg.empathy, judgement.empatia);

  const visualShare = clamp(num(cfg.empathy.visualWeight, 20)) / 100;
  const facingMin = num(cfg.expression.criteria.facing.idealMinPct, 75) / 100;
  const facing = metrics?.body?.available ? rangeScore(metrics.body.facingCamera, facingMin, 1, facingMin * 0.25, 2) : null;
  const empathy =
    empathyContent.score == null ? null : facing == null ? empathyContent.score : empathyContent.score * (1 - visualShare) + facing * visualShare;

  const weights = {
    expression: num(cfg.areas.expression, 25),
    voice: num(cfg.areas.voice, 25),
    coherence: num(cfg.areas.coherence, 30),
    empathy: num(cfg.areas.empathy, 20),
  };

  const areas = [
    { key: 'expression', label: 'Expresión', score: body.score, weight: weights.expression, details: body.details, source: 'Cámara (MediaPipe)' },
    { key: 'voice', label: 'Tono de voz', score: voice.score, weight: weights.voice, details: voice.details, source: 'Micrófono' },
    { key: 'coherence', label: 'Coherencia', score: round(coherence.score), weight: weights.coherence, details: coherence.details, source: 'IA evaluadora' },
    {
      key: 'empathy',
      label: 'Empatía',
      score: round(empathy),
      weight: weights.empathy,
      details: empathyContent.details,
      source: facing == null ? 'IA evaluadora' : `IA evaluadora + mirada (${Math.round(visualShare * 100)}%)`,
    },
  ];

  return {
    global: round(average(areas)),
    areas,
    weights,
    pattern: pattern ? { id: pattern.id, version: pattern.version, name: pattern.name || null, source: patternSource } : null,
    patternVersion: pattern?.version ?? null,
    strictness: cfg.strictness,
    resumen: judgement.resumen,
    cita: judgement.cita,
    fortalezas: judgement.fortalezas,
    mejoras: judgement.mejoras,
    mensajesClave: judgement.mensajesClave,
    lineasRojas: judgement.lineasRojas,
    porPregunta: judgement.porPregunta,
    sensibilidad: buildSensitivity(metrics?.body, transcript, theme),
    measured: { voice: metrics?.voice || null, body: metrics?.body || null, lighting: metrics?.lighting || null },
    ai: { evaluator: model, ms },
    generatedAt: new Date(at).toISOString(),
  };
}
