import assert from 'node:assert/strict';
import test from 'node:test';

// Silenciado del entrevistador (regresión del audio que sonaba al finalizar la entrevista).
//
// `voice.js` aplaza la lectura con `setTimeout(..., 0)` cuando el navegador ya está hablando:
// ese temporizador no lo detiene `speechSynthesis.cancel()`, así que una pregunta aplazada
// podía empezar a sonar durante la transición al análisis. Se sustituye la síntesis por un
// doble controlable para comprobarlo sin navegador.

const spoken = [];
let cancelCalls = 0;
let speaking = false;
let hasSynthesis = true;

const speechSynthesis = {
  get speaking() {
    return speaking;
  },
  pending: false,
  speak: (utterance) => spoken.push(utterance.text),
  cancel: () => {
    cancelCalls += 1;
  },
};

globalThis.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text;
  }
};
globalThis.window = {
  get speechSynthesis() {
    return hasSynthesis ? speechSynthesis : undefined;
  },
};

const { speak, stopSpeaking } = await import('../voice.js');

const reset = ({ busy = false, synthesis = true } = {}) => {
  spoken.length = 0;
  cancelCalls = 0;
  speaking = busy;
  hasSynthesis = synthesis;
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('lee de inmediato cuando el navegador está libre', () => {
  reset();
  speak('Pregunta uno', null);
  assert.deepEqual(spoken, ['Pregunta uno']);
  assert.equal(cancelCalls, 0);
});

test('aplaza la lectura un tick si el navegador está ocupado', async () => {
  reset({ busy: true });
  speak('Pregunta dos', null);
  assert.deepEqual(spoken, [], 'no habla en el mismo tick que la cancelación');
  await tick();
  assert.deepEqual(spoken, ['Pregunta dos']);
});

test('stopSpeaking() impide que la lectura aplazada suene (audio al finalizar)', async () => {
  reset({ busy: true });
  speak('Pregunta que no debe sonar', null);
  const cancelsBeforeStop = cancelCalls;
  stopSpeaking();
  await tick();
  assert.deepEqual(spoken, [], 'la pregunta aplazada no arranca tras terminar la entrevista');
  assert.equal(cancelCalls, cancelsBeforeStop + 1, 'además se cancela lo que estuviera sonando');
});

test('una lectura nueva reemplaza a la aplazada anterior', async () => {
  reset({ busy: true });
  speak('Pregunta vieja', null);
  speak('Pregunta nueva', null);
  await tick();
  assert.deepEqual(spoken, ['Pregunta nueva']);
});

test('stopSpeaking() silencia también la lectura en curso', () => {
  reset({ busy: true });
  stopSpeaking();
  assert.equal(cancelCalls, 1);
});

test('sin soporte de síntesis no lanza y avisa del motivo', () => {
  reset({ synthesis: false });
  const reasons = [];
  const utterance = speak('Pregunta', null, { onError: (reason) => reasons.push(reason) });
  assert.equal(utterance, null);
  assert.deepEqual(reasons, ['unavailable']);
  assert.doesNotThrow(() => stopSpeaking());
});
