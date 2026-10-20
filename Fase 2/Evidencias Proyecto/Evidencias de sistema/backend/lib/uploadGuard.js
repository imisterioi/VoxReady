// Guardado de subidas binarias (audio/video de una sesión) con límites y limpieza.
//
// Reglas:
//  - Se escribe primero en `<destino>.part` y solo se renombra cuando termina bien: nunca
//    queda un archivo a medias con el nombre definitivo.
//  - Si se supera el tamaño máximo, si el cliente corta la conexión o si el contenido no
//    parece WebM (cabecera EBML), se borra el parcial y se devuelve un código estable.
//  - No se guarda nada en memoria más allá de los primeros bytes (para validar la cabecera).
const fs = require('fs');
const path = require('path');

// Todo WebM/Matroska empieza por la firma EBML 1A 45 DF A3.
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

function unlinkQuiet(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* best-effort */
  }
}

function saveStreamToFile(req, destPath, { maxBytes, validateMagic = true } = {}) {
  return new Promise((resolve, reject) => {
    const partial = `${destPath}.part`;
    const stream = fs.createWriteStream(partial);
    let bytes = 0;
    let head = Buffer.alloc(0);
    let settled = false;

    const failWith = (code) => {
      if (settled) return;
      settled = true;
      req.unpipe?.(stream);
      req.resume?.(); // se descarta el resto sin dejar la conexión colgada
      stream.destroy();
      unlinkQuiet(partial);
      reject(Object.assign(new Error(code), { code }));
    };

    req.on('data', (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (head.length < 4) head = Buffer.concat([head, chunk]).subarray(0, 4);
      if (maxBytes && bytes > maxBytes) {
        failWith('TOO_LARGE');
      }
    });
    req.on('aborted', () => failWith('ABORTED'));
    req.on('error', () => failWith('ABORTED'));
    stream.on('error', () => failWith('WRITE_ERROR'));

    stream.on('finish', () => {
      if (settled) return;
      if (validateMagic && (head.length < 4 || !head.equals(EBML_MAGIC))) {
        settled = true;
        unlinkQuiet(partial);
        reject(Object.assign(new Error('INVALID_CONTENT'), { code: 'INVALID_CONTENT' }));
        return;
      }
      settled = true;
      try {
        fs.renameSync(partial, destPath);
      } catch {
        unlinkQuiet(partial);
        reject(Object.assign(new Error('WRITE_ERROR'), { code: 'WRITE_ERROR' }));
        return;
      }
      resolve({ bytes });
    });

    // El tope se aplica en el 'data'; al superar el límite se corta la entrada.
    req.on('limit', () => failWith('TOO_LARGE'));
    req.pipe(stream);
    req.on('close', () => {
      if (!req.readableEnded) failWith('ABORTED');
    });
  });
}

// Borra los dos archivos posibles de una sesión (video y audio) de forma idempotente.
function removeSessionMedia(sessionId, dir) {
  let removed = 0;
  for (const suffix of ['.webm', '.audio.webm']) {
    const file = path.join(dir, `${sessionId}${suffix}`);
    if (fs.existsSync(file)) {
      unlinkQuiet(file);
      removed += 1;
    }
  }
  return removed;
}

module.exports = { EBML_MAGIC, removeSessionMedia, saveStreamToFile };
