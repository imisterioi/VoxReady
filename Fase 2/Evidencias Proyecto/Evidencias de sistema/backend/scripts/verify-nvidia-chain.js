// Verificación manual de la cadena: audio de sesión → ventanas NVIDIA → evaluador.
//
//   cd backend
//   node scripts/verify-nvidia-chain.js "uploads/sessions/<id>.audio.webm"
//
// Usa la misma lógica que `POST /api/sessions/:id/evaluate` (transcribeAnswers +
// normalizeEvaluateInput) sin tocar la base de datos ni crear sesiones. Sirve para
// comprobar qué texto recibe el evaluador para cada ventana. No imprime la clave.
const fs = require('node:fs');
const path = require('node:path');
const { transcribeAnswers } = require('../lib/nvidiaTranscribe');
const { normalizeEvaluateInput } = require('../lib/evaluationInput');

// Carga mínima de .env.local (sin dotenv) para disponer de NVIDIA_API_KEY.
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/verify-nvidia-chain.js <ruta-al-audio.webm> [start1 end1 start2 end2]');
  process.exit(2);
}

const args = process.argv.slice(3).map(Number);
const windows =
  args.length >= 4
    ? [
        { startMs: args[0], endMs: args[1] },
        { startMs: args[2], endMs: args[3] },
      ]
    : [
        { startMs: 5000, endMs: 15000 },
        { startMs: 60000, endMs: 70000 },
      ];

const turns = windows.map((window, index) => ({ question: `pregunta ${index + 1}`, ...window, metrics: {} }));

(async () => {
  const started = Date.now();
  const result = await transcribeAnswers({ filePath: path.resolve(file), turns });
  console.log('transcripcion:', {
    ok: result.ok,
    code: result.code || null,
    ventanas: result.windows,
    ms: Date.now() - started,
  });
  if (!result.ok) {
    console.log('respuestas:', result.answers, 'fallos:', result.failures);
    process.exit(1);
  }

  const input = normalizeEvaluateInput({
    transcript: turns.map((turn, index) => ({ ...turn, answer: result.answers[index] })),
    metrics: {},
  });
  console.log(
    'evaluador:',
    input.transcript.map((turn) => ({ pregunta: turn.question, palabras: turn.metrics.words, texto: turn.answer })),
  );
})();
