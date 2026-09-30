'use strict';
// T2 — la lectura local: qué puede abrirse, qué no, y qué dice el recibo cuando no.
//
// El rojo real (RC4, `notas/2026-09-29_primer-uso-rc4.json`): una auditoría local sin gasto
// terminó en `needs_human_decision` con `detail: null`. El efecto estaba calculado por
// `sufficient()` y se perdió en el camino. Aquí se fija primero la honestidad del rechazo;
// después, el control adversarial; y al final, el límite que no se puede hacer cumplir.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOperation, runOperation, STATES } = require('../src/operation.js');

const VERIFY_OK = async () => ({ verified: true, checks: { manifiesto: true }, reason: 'segunda lectura independiente' });

// El alcance que la autoridad nombra. Un grant de lectura no gasta cantidad: nombra el activo y
// el destino, con cantidad cero. `respaldo` ya usa esta misma forma con cantidad uno
// (`capabilities/respaldo/capability.js`): el canal de grant es genérico, no es dinero.
const ALCANCE = path.join(os.tmpdir(), 'vespi-t2-lectura', 'build');
const FUERA = path.join(os.tmpdir(), 'vespi-t2-lectura-fuera');
const RAIZ = path.join(os.tmpdir(), 'vespi-t2-lectura');

function grantDeLectura(destino) {
  return { spend: [{ asset: 'lectura:local', maxAmount: '0', to: destino }] };
}

after(() => {
  fs.rmSync(RAIZ, { recursive: true, force: true });
  fs.rmSync(FUERA, { recursive: true, force: true });
});

test('T2-R1: un efecto no declarado devuelve un recibo que nombra la causa', async () => {
  let performs = 0;
  const cap = {
    id: 'auditoria-sin-declarar',
    required: () => ({ spend: [] }),
    perform: async () => { performs++; return { ok: true, evidence: { status: 'ok' } }; },
  };
  const res = await runOperation(createOperation({ goal: 'auditar el build local', authority: { spend: [] } }), cap, {
    verify: VERIFY_OK,
  });
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.equal(performs, 0);
  assert.match(res.receipt.detail || '', /no spend requirement declared/);
  assert.equal(res.receipt.authority.approval, 'human_gate_no_decision');
  assert.equal(res.receipt.decidedBy, undefined, 'el recibo no inventa a quién pidió');
});

test('T2-R2: un grant de lectura que no alcanza el alcance nombrado dice cuál falta', async () => {
  let performs = 0;
  const cap = {
    id: 'auditoria-lectura',
    required: () => ({ spend: [{ asset: 'lectura:local', amount: '0', to: ALCANCE }] }),
    perform: async () => { performs++; return { ok: true, evidence: { status: 'ok' } }; },
  };
  const res = await runOperation(createOperation({ goal: 'auditar', authority: grantDeLectura(path.join(RAIZ, 'otro')) }), cap, {
    verify: VERIFY_OK,
  });
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.equal(performs, 0);
  assert.match(res.receipt.detail || '', /no grant for asset lectura:local to/);
  assert.equal(res.receipt.authority.approval, 'human_gate_no_decision');
});

test('T2-R3: una capability que miente `spend: []` no alcanza su perform bajo ninguna puerta', async () => {
  // Intenta las tres cosas que un grant de lectura debería impedir: escribir, llamar a un
  // endpoint y gastar. El contador de `perform` es la aserción; los tres intentos se observan
  // desde adentro, porque si `perform` corre, el kernel ya perdió.
  const intentos = { performs: 0, escrituras: 0, endpoints: 0, pagos: 0 };
  const cap = {
    id: 'mentirosa',
    required: () => ({ spend: [] }),
    perform: async () => {
      intentos.performs++;
      intentos.escrituras++;
      intentos.endpoints++;
      intentos.pagos++;
      return { ok: true, evidence: { status: 'ok' } };
    },
  };

  const configuraciones = [
    ['sin puerta', { spend: [] }, { verify: VERIFY_OK }],
    ['ask aprueba', { spend: [] }, { ask: async () => ({ approved: true }), verify: VERIFY_OK }],
    ['ask aprueba y nombra', { spend: [] }, { ask: async () => ({ approved: true, by: 'andre' }), verify: VERIFY_OK }],
    ['multifirma', { spend: [], signers: { required: 1, allowed: ['andre'] } },
      { ask: async () => ({ approved: true, by: 'andre' }), verify: VERIFY_OK }],
  ];

  for (const [nombre, authority, io] of configuraciones) {
    const antes = { ...intentos };
    const res = await runOperation(createOperation({ goal: 'mentira', authority }), cap, io);
    assert.ok([STATES.NEEDS_DECISION, STATES.FAILED].includes(res.status), `${nombre}: estado inesperado ${res.status}`);
    assert.equal(intentos.performs - antes.performs, 0, `${nombre}: perform corrió`);
    assert.equal(intentos.escrituras - antes.escrituras, 0, `${nombre}: la escritura llegó a ocurrir`);
    assert.equal(intentos.endpoints - antes.endpoints, 0, `${nombre}: la llamada al endpoint llegó a ocurrir`);
    assert.equal(intentos.pagos - antes.pagos, 0, `${nombre}: el pago llegó a ocurrir`);
    assert.notEqual(res.receipt.status, 'verified', `${nombre}: la mentira no puede volver verificada`);
  }
  assert.equal(intentos.performs, 0, 'el contador total de llamadas a perform es cero');
});

test('T2-R4: la auditoría local legítima corre con alcance nombrado y no atribuye aprobación humana', async () => {
  fs.mkdirSync(ALCANCE, { recursive: true });
  fs.writeFileSync(path.join(ALCANCE, 'RECIBO.json'), '{"ok":true}', 'utf8');
  const entradas = [];
  let ejecuciones = 0;
  const cap = {
    id: 'auditoria-local',
    required: () => ({ spend: [{ asset: 'lectura:local', amount: '0', to: ALCANCE }] }),
    perform: async () => {
      ejecuciones++;
      entradas.push(fs.readdirSync(ALCANCE));
      return { ok: true, evidence: { operationId: 'op-t2', status: 'auditoria_local' } };
    },
  };
  const res = await runOperation(
    createOperation({ goal: 'auditar el build local', authority: grantDeLectura(ALCANCE) }),
    cap,
    { verify: VERIFY_OK },
  );
  assert.equal(res.status, STATES.SUCCEEDED, 'el grant declarado nombra el alcance, así que abre');
  assert.equal(ejecuciones, 1, 'la ejecución es observable y ocurre exactamente una vez');
  assert.deepEqual(entradas, [['RECIBO.json']], 'la capability leyó el alcance que la autoridad nombró');
  assert.equal(res.receipt.authority.approval, 'preauthorized', 'nadie pidió nada: el recibo no inventa una puerta');
  assert.equal(res.receipt.decidedBy, undefined);
  assert.deepEqual(res.receipt.coverage, ['manifiesto'], 'la cobertura es la del verificador independiente');
  assert.equal(res.receipt.verification.reason, 'segunda lectura independiente');
});

test('T2-R5: una etiqueta autodeclarada no es autoridad (y por eso no hay vía de lectura por etiqueta)', async () => {
  // Si el kernel abriera una vía de lectura apoyada en `readOnly`/`effect`, esta capability
  // correría sin que nadie le hubiera concedido nada. Se escribe para que el día que alguien
  // añada esa vía, la prueba se caiga.
  const cuenta = { performs: 0 };
  const cap = {
    id: 'se-declara-solo-lectura',
    readOnly: true,
    effect: 'none',
    required: () => ({ spend: [] }),
    perform: async () => { cuenta.performs++; return { ok: true, evidence: { status: 'ok' } }; },
  };
  for (const authority of [{ spend: [] }, {}, { read: ['*'] }, { readOnly: true }, { spend: [{ asset: 'lectura:local', maxAmount: '0' }] }]) {
    const res = await runOperation(createOperation({ goal: 'solo lectura', authority }), cap, {
      ask: async () => ({ approved: true, by: 'andre' }),
      verify: VERIFY_OK,
    });
    assert.notEqual(res.status, STATES.SUCCEEDED, `una etiqueta no abre nada: ${JSON.stringify(authority)}`);
  }
  assert.equal(cuenta.performs, 0, 'ninguna etiqueta autodeclarada llega a perform');
});

test('T2-R6: un grant declarado no es una caja de arena — el límite que el kernel no hace cumplir', async () => {
  // Éste es el contraejemplo ejecutable de la decisión de alcance. La capability declara un
  // grant de lectura honesto, se autodeclara `readOnly`, y al llegar a perform escribe fuera
  // del alcance concedido y hace una llamada saliente. El kernel lo permite: ejecuta código
  // arbitrario en el mismo proceso. El recibo sale `verified` y no menciona la escritura.
  // Verde aquí significa «el límite sigue existiendo», NO «el grant acota el efecto».
  fs.mkdirSync(ALCANCE, { recursive: true });
  fs.mkdirSync(FUERA, { recursive: true });
  const fuera = path.join(FUERA, 'escrito.txt');
  let llamadas = 0;
  const cap = {
    id: 'lee-pero-escribe',
    readOnly: true,
    required: () => ({ spend: [{ asset: 'lectura:local', amount: '0', to: ALCANCE }] }),
    perform: async () => {
      llamadas++;
      fs.writeFileSync(fuera, 'efecto fuera del alcance declarado', 'utf8');
      return { ok: true, evidence: { status: 'ok' } };
    },
  };
  const res = await runOperation(createOperation({ goal: 'leer', authority: grantDeLectura(ALCANCE) }), cap, {
    verify: VERIFY_OK,
  });
  assert.equal(res.status, STATES.SUCCEEDED, 'el kernel ejecuta código arbitrario: no puede hacer cumplir el efecto');
  assert.equal(llamadas, 1);
  assert.equal(fs.existsSync(fuera), true, 'la escritura fuera del alcance ocurrió de todos modos');
  const serializado = JSON.stringify(res.receipt);
  assert.equal(serializado.includes('escrito.txt'), false, 'el recibo no registra el efecto que no declaró');
});
