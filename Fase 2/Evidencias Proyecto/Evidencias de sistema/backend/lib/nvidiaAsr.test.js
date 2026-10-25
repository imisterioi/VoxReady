// Pruebas del cliente de ASR alojado (sin red, sin Python, sin credenciales).
//   cd backend && node --test lib/nvidiaAsr.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { runAsr, resolvePython } = require('./nvidiaAsr');
const { ASR_MODELS, VOICE_MODELS, isCallable, asrModel } = require('./nvidiaCatalog');

// Doble de proceso: emite la salida indicada y cierra.
function fakeSpawn({ stdout = '', stderr = '', code = 0, hang = false } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit('close', 143, 'SIGTERM');
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      if (!hang) child.emit('close', code, null);
    });
    return child;
  };
}

const env = { NVIDIA_API_KEY: 'clave-de-prueba' };

test('el catálogo sólo marca como llamables los modelos con host y function-id', () => {
  for (const model of ASR_MODELS) {
    if (model.availability === 'ready') {
      assert.ok(model.host && model.functionId, `${model.key} sin endpoint`);
    } else {
      assert.equal(model.functionId, null, `${model.key} no debe inventar function-id`);
      assert.equal(isCallable(model), false);
    }
  }
  assert.equal(isCallable(asrModel('parakeet-tdt-0.6b')), false);
});

test('Nemotron VoiceChat queda como acceso temprano, sin endpoint inventado', () => {
  const voice = VOICE_MODELS.find((model) => model.key === 'nemotron-voicechat');
  assert.equal(voice.availability, 'early_access');
  assert.equal(voice.host, null);
  assert.equal(voice.functionId, null);
});

test('sin NVIDIA_API_KEY no se lanza ningún proceso', async () => {
  let called = false;
  const result = await runAsr({
    modelKey: 'whisper-large-v3',
    filePath: 'x.webm',
    env: {},
    spawnImpl: () => {
      called = true;
      return new EventEmitter();
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NO_KEY');
  assert.equal(called, false);
});

test('un modelo no llamable se rechaza antes de ejecutar', async () => {
  const result = await runAsr({ modelKey: 'parakeet-tdt-0.6b', filePath: 'x.webm', env, spawnImpl: fakeSpawn() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NOT_AVAILABLE');
});

test('un modelo desconocido no ejecuta nada', async () => {
  const result = await runAsr({ modelKey: 'no-existe', filePath: 'x.webm', env, spawnImpl: fakeSpawn() });
  assert.equal(result.code, 'UNKNOWN_MODEL');
});

test('parsea la respuesta JSON del cliente y le añade el modelo', async () => {
  const stdout = 'ruido\n' + JSON.stringify({ ok: true, text: 'hola', segments: [], elapsedMs: 12, decoded: { converted: true } });
  const result = await runAsr({ modelKey: 'whisper-large-v3', filePath: 'x.webm', env, spawnImpl: fakeSpawn({ stdout }) });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'hola');
  assert.equal(result.modelKey, 'whisper-large-v3');
});

test('una salida no interpretable se informa, no se ignora', async () => {
  const result = await runAsr({ modelKey: 'whisper-large-v3', filePath: 'x.webm', env, spawnImpl: fakeSpawn({ stdout: 'no json', stderr: 'traceback' }) });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BAD_OUTPUT');
  assert.match(result.message, /no json|traceback/);
});

test('si Python no existe se informa PYTHON_MISSING', async () => {
  const result = await runAsr({
    modelKey: 'whisper-large-v3',
    filePath: 'x.webm',
    env,
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => child.emit('error', Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' })));
      return child;
    },
  });
  assert.equal(result.code, 'PYTHON_MISSING');
});

test('un proceso colgado se corta por timeout y se informa', async () => {
  const result = await runAsr({
    modelKey: 'whisper-large-v3',
    filePath: 'x.webm',
    env,
    timeoutMs: 20,
    spawnImpl: fakeSpawn({ hang: true }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TIMEOUT');
});

test('resolvePython prioriza PYTHON_EXECUTABLE y limpia comillas y espacios', () => {
  assert.equal(
    resolvePython({ PYTHON_EXECUTABLE: 'C:\\Program Files\\Python311\\python.exe' }),
    'C:\\Program Files\\Python311\\python.exe',
  );
  assert.equal(
    resolvePython({ PYTHON_EXECUTABLE: '"C:\\Program Files\\Python311\\python.exe"' }),
    'C:\\Program Files\\Python311\\python.exe',
  );
  assert.equal(resolvePython({ PYTHON_EXECUTABLE: '  /usr/bin/python3  ' }), '/usr/bin/python3');
  assert.equal(resolvePython({ PYTHON_EXECUTABLE: "'C:\\Py\\python.exe'" }), 'C:\\Py\\python.exe');
});

test('resolvePython usa NVIDIA_PYTHON como alternativa y python como último recurso', () => {
  assert.equal(resolvePython({ NVIDIA_PYTHON: 'python3.11' }), 'python3.11');
  assert.equal(resolvePython({ PYTHON_EXECUTABLE: 'explicito', NVIDIA_PYTHON: 'alternativa' }), 'explicito');
  assert.equal(resolvePython({}), 'python');
});

test('runAsr lanza el intérprete configurado, con rutas que tienen espacios', async () => {
  const seen = [];
  const capturing = (cmd, args) => {
    seen.push({ cmd, args });
    return fakeSpawn({ stdout: JSON.stringify({ ok: true, text: 'ok', segments: [] }) })(cmd, args);
  };

  await runAsr({
    modelKey: 'whisper-large-v3',
    filePath: 'x.webm',
    env: { NVIDIA_API_KEY: 'k', PYTHON_EXECUTABLE: 'C:\\Program Files\\Python311\\python.exe' },
    spawnImpl: capturing,
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].cmd, 'C:\\Program Files\\Python311\\python.exe');
  // La ruta del audio y los metadatos van como argumentos separados (sin comillas manuales).
  assert.ok(seen[0].args.includes('--input-file'));
  assert.ok(seen[0].args.includes('x.webm'));
});

test('un intérprete inexistente informa la ruta intentada', async () => {
  const result = await runAsr({
    modelKey: 'whisper-large-v3',
    filePath: 'x.webm',
    env: { NVIDIA_API_KEY: 'k', PYTHON_EXECUTABLE: '/opt/nada/python3' },
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
      return child;
    },
  });
  assert.equal(result.code, 'PYTHON_MISSING');
  assert.match(result.message, /\/opt\/nada\/python3/);
  assert.doesNotMatch(result.message, /nvapi-|Bearer/);
});

