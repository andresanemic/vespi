// RS1 TDD (ROJO primero): el respaldo del jardín como capacidad de Vespi (fila R51).
// Cero dependencias: node:test + node:assert + node:fs/crypto/path.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');

const { createOperation, runOperation, STATES } = require('../src/operation.js');
const {
  EXCLUIDOS_POR_DEFECTO,
  respaldar,
  verificar,
  restaurar,
  dondeEsta,
  respaldoCapability,
  crearVerificador,
} = require('../capabilities/respaldo/index.js');

const raices = [];
function raiz(nombre) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `respaldo-${nombre}-`));
  raices.push(dir);
  return dir;
}
after(() => {
  for (const dir of raices) fs.rmSync(dir, { recursive: true, force: true });
});

function escribir(base, relativa, datos) {
  const completa = path.join(base, relativa);
  fs.mkdirSync(path.dirname(completa), { recursive: true });
  fs.writeFileSync(completa, datos);
  return completa;
}

const binario = (bytes) => randomBytes(bytes);
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const leerManifiesto = (destino) => JSON.parse(fs.readFileSync(path.join(destino, 'manifiesto.json'), 'utf8'));
const rutas = (manifiesto) => manifiesto.archivos.map((a) => a.ruta).sort();

// Un jardín de trabajo: criterio, sitio, imagen y video.
function jardin(base) {
  escribir(base, 'lore/identidad.md', '# Identidad\n\nSomos una persona y su trabajo.\n');
  escribir(base, 'sitio/index.html', '<!doctype html><title>Sitio</title>');
  escribir(base, 'assets/logo.png', binario(4096));
  escribir(base, 'assets/foto.png', binario(2048));
  escribir(base, 'videos/clip.mp4', binario(64 * 1024));
  return base;
}

test('RS1.1 respaldar copia texto y binarios y escribe manifiesto.json con tamaño, huella y fecha', async () => {
  const origen = jardin(raiz('origen'));
  const destino = raiz('destino');

  const r = await respaldar({ origen, destino });

  assert.equal(r.ok, true);
  assert.equal(r.copiados, 5);
  assert.deepEqual(r.excluidos, []);
  assert.ok(r.bytes > 64 * 1024, 'los bytes del árbol incluyen el video');

  // El binario llegó byte a byte, no como texto.
  assert.ok(fs.readFileSync(path.join(origen, 'videos/clip.mp4')).equals(fs.readFileSync(path.join(destino, 'videos/clip.mp4'))));
  assert.equal(fs.readFileSync(path.join(destino, 'lore/identidad.md'), 'utf8'), fs.readFileSync(path.join(origen, 'lore/identidad.md'), 'utf8'));

  const manifiesto = leerManifiesto(destino);
  assert.deepEqual(rutas(manifiesto), ['assets/foto.png', 'assets/logo.png', 'lore/identidad.md', 'sitio/index.html', 'videos/clip.mp4']);
  const logo = manifiesto.archivos.find((a) => a.ruta === 'assets/logo.png');
  assert.equal(logo.bytes, 4096);
  assert.equal(logo.huella, sha256(fs.readFileSync(path.join(origen, 'assets/logo.png'))));
  assert.match(logo.fecha, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(manifiesto.archivos.length, manifiesto.total_archivos);
  assert.equal(manifiesto.huella, r.huella);
  assert.match(manifiesto.huella, /^[0-9a-f]{64}$/);
});

test('RS1.2 es incremental: la segunda pasada no copia nada, y solo copia lo nuevo o lo cambiado', async () => {
  const origen = raiz('origen');
  const destino = raiz('destino');
  escribir(origen, 'a.txt', 'uno');
  escribir(origen, 'carpeta/b.txt', 'dos');

  const primera = await respaldar({ origen, destino });
  assert.equal(primera.copiados, 2);

  const segunda = await respaldar({ origen, destino });
  assert.equal(segunda.copiados, 0);
  assert.equal(segunda.sinCambios, 2);

  escribir(origen, 'c.txt', 'tres');
  fs.writeFileSync(path.join(origen, 'a.txt'), 'uno, ahora distinto');
  const tercera = await respaldar({ origen, destino });
  assert.deepEqual(tercera.rutas.sort(), ['a.txt', 'c.txt']);
  assert.equal(tercera.sinCambios, 1);
  assert.equal(fs.readFileSync(path.join(destino, 'a.txt'), 'utf8'), 'uno, ahora distinto');
  assert.deepEqual(rutas(leerManifiesto(destino)), ['a.txt', 'c.txt', 'carpeta/b.txt']);
});

test('RS1.3 excluye node_modules, .git y lo que diga excluir, y nunca borra nada del destino', async () => {
  const origen = raiz('origen');
  const destino = raiz('destino');
  escribir(origen, 'lore/identidad.md', 'criterio');
  escribir(origen, 'node_modules/paquete/index.js', 'no');
  escribir(origen, '.git/config', 'no');
  escribir(origen, 'tmp/cache.bin', binario(16));
  escribir(origen, 'privado/secreto.txt', 'no');
  fs.writeFileSync(path.join(destino, 'nota-del-humano.txt'), 'esto lo puse yo a mano');
  const excluir = ['tmp', 'privado'];

  const r = await respaldar({ origen, destino, excluir });

  assert.deepEqual(EXCLUIDOS_POR_DEFECTO, ['node_modules', '.git']);
  assert.equal(r.copiados, 1);
  assert.deepEqual(rutas(leerManifiesto(destino)), ['lore/identidad.md']);
  assert.equal(fs.existsSync(path.join(destino, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(destino, '.git')), false);
  assert.equal(fs.existsSync(path.join(destino, 'tmp')), false);
  assert.equal(fs.existsSync(path.join(destino, 'privado')), false);

  // Segunda pasada y archivo que se borró del origen: el destino no se toca.
  fs.rmSync(path.join(origen, 'lore/identidad.md'));
  await respaldar({ origen, destino, excluir });
  assert.equal(fs.readFileSync(path.join(destino, 'nota-del-humano.txt'), 'utf8'), 'esto lo puse yo a mano');
  assert.equal(fs.existsSync(path.join(destino, 'lore/identidad.md')), true, 'lo que ya estaba en el destino no se borra');
  assert.deepEqual(rutas(leerManifiesto(destino)), [], 'el manifiesto describe el árbol de ahora, no el de antes');
});

test('RS1.4 verificar da todo íntegro y después nombra el archivo alterado y el que falta', async () => {
  const origen = jardin(raiz('origen'));
  const destino = raiz('destino');
  await respaldar({ origen, destino });

  const bien = await verificar({ destino });
  assert.equal(bien.ok, true);
  assert.equal(bien.integros.length, 5);
  assert.deepEqual(bien.cambiaron, []);
  assert.deepEqual(bien.faltan, []);
  assert.equal(bien.manifiestoIntacto, true);

  fs.writeFileSync(path.join(destino, 'assets/logo.png'), 'lo cambiaron por fuera');
  fs.rmSync(path.join(destino, 'lore/identidad.md'));

  const mal = await verificar({ destino });
  assert.equal(mal.ok, false);
  assert.deepEqual(mal.cambiaron, ['assets/logo.png']);
  assert.deepEqual(mal.faltan, ['lore/identidad.md']);
  assert.ok(mal.integros.includes('videos/clip.mp4'));
  assert.equal(mal.integros.length, 3);
  assert.equal(mal.manifiestoIntacto, true);
});

test('RS1.5 verificar avisa cuando el manifiesto mismo fue editado a mano', async () => {
  const origen = jardin(raiz('origen'));
  const destino = raiz('destino');
  await respaldar({ origen, destino });
  const manifiesto = leerManifiesto(destino);
  manifiesto.archivos[0].huella = '0'.repeat(64);
  fs.writeFileSync(path.join(destino, 'manifiesto.json'), JSON.stringify(manifiesto, null, 2));

  const r = await verificar({ destino });
  assert.equal(r.ok, false);
  assert.equal(r.manifiestoIntacto, false);
});

test('RS1.6 restaurar devuelve un archivo íntegro y no sobrescribe sin autorización explícita', async () => {
  const origen = jardin(raiz('origen'));
  const destino = raiz('destino');
  await respaldar({ origen, destino });
  fs.rmSync(path.join(origen, 'lore/identidad.md'));
  const a = raiz('devuelto');
  const final = path.join(a, 'identidad.md');

  const primero = await restaurar({ destino, archivo: 'lore/identidad.md', a: final });
  assert.equal(primero.ok, true);
  assert.equal(primero.sobrescrito, false);
  assert.equal(fs.readFileSync(final, 'utf8'), '# Identidad\n\nSomos una persona y su trabajo.\n');

  fs.writeFileSync(final, 'EDITADO POR LA PERSONA');
  const segundo = await restaurar({ destino, archivo: 'lore/identidad.md', a: final });
  assert.equal(segundo.ok, false);
  assert.equal(segundo.yaExiste, true);
  assert.equal(fs.readFileSync(final, 'utf8'), 'EDITADO POR LA PERSONA');

  const conPermiso = await restaurar({ destino, archivo: 'lore/identidad.md', a: final, sobrescribir: true });
  assert.equal(conPermiso.ok, true);
  assert.equal(conPermiso.sobrescrito, true);
  assert.notEqual(fs.readFileSync(final, 'utf8'), 'EDITADO POR LA PERSONA');
});

test('RS1.7 restaurar se niega a devolver una copia que ya no está íntegra', async () => {
  const origen = jardin(raiz('origen'));
  const destino = raiz('destino');
  await respaldar({ origen, destino });
  fs.writeFileSync(path.join(destino, 'assets/logo.png'), 'lo cambiaron por fuera');
  const a = raiz('devuelto');
  const final = path.join(a, 'logo.png');

  const r = await restaurar({ destino, archivo: 'assets/logo.png', a: final });
  assert.equal(r.ok, false);
  assert.match(r.error, /huella|íntegr/i);
  assert.equal(fs.existsSync(final), false, 'no se devuelve una copia que no es la que se respaldó');
});

test('RS1.8 restaurar devuelve una carpeta completa conservando la estructura', async () => {
  const origen = jardin(raiz('origen'));
  const destino = raiz('destino');
  await respaldar({ origen, destino });
  const a = raiz('devuelto');

  const r = await restaurar({ destino, archivo: 'assets', a });

  assert.equal(r.ok, true);
  assert.deepEqual(r.restaurados.sort(), ['assets/foto.png', 'assets/logo.png']);
  assert.equal(fs.readFileSync(path.join(a, 'assets/logo.png')).length, 4096);
  assert.ok(fs.readFileSync(path.join(origen, 'assets/foto.png')).equals(fs.readFileSync(path.join(a, 'assets/foto.png'))));
});

test('RS1.9 dondeEsta responde dónde está la última copia y, si no hay copia, lo dice', async () => {
  const origen = jardin(raiz('origen'));
  const destino = raiz('destino');
  await respaldar({ origen, destino });

  const parcial = await dondeEsta({ destino, nombre: 'clip' });
  assert.equal(parcial.hayCopia, true);
  assert.equal(parcial.copias.length, 1);
  assert.equal(parcial.copias[0].ruta, 'videos/clip.mp4');
  assert.equal(parcial.copias[0].donde, path.join(destino, 'videos/clip.mp4'));
  assert.equal(parcial.copias[0].bytes, 64 * 1024);
  assert.match(parcial.copias[0].fecha, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(parcial.copias[0].huella, /^[0-9a-f]{64}$/);
  assert.equal(parcial.ultima.ruta, 'videos/clip.mp4');

  assert.equal((await dondeEsta({ destino, nombre: 'LOGO' })).copias[0].ruta, 'assets/logo.png', 'el nombre parcial no distingue mayúsculas');
  assert.equal((await dondeEsta({ destino, nombre: 'lore/identidad' })).copias.length, 1, 'el nombre parcial puede ser parte de la ruta');

  const varias = await dondeEsta({ destino, nombre: 'png' });
  assert.equal(varias.copias.length, 2);

  const ninguna = await dondeEsta({ destino, nombre: 'este-archivo-no-existe' });
  assert.equal(ninguna.hayCopia, false);
  assert.deepEqual(ninguna.copias, []);
  assert.match(ninguna.motivo, /no hay copia/);

  const sinManifiesto = await dondeEsta({ destino: raiz('vacio'), nombre: 'logo' });
  assert.equal(sinManifiesto.hayCopia, false);
  assert.match(sinManifiesto.motivo, /manifiesto/i);
});

test('RS1.10 la capacidad corre dentro de runOperation con destino autorizado y deja recibo verificado', async () => {
  const origen = jardin(raiz('origen'));
  const destino = raiz('destino');
  const cap = respaldoCapability({ origen, destino });
  assert.equal(cap.id, 'respaldo');

  const op = createOperation({
    goal: 'respaldar el jardín en la carpeta que ya sincroniza el disco',
    action: 'respaldar',
    authority: { spend: [{ asset: 'respaldo:carpeta', maxAmount: '1', to: destino }] },
  });
  const res = await runOperation(op, cap, { verify: crearVerificador({ destino }), ask: async () => ({ approved: false, by: 'andres' }) });

  assert.equal(res.status, STATES.SUCCEEDED);
  assert.equal(res.receipt.status, 'verified');
  assert.equal(res.receipt.capability, 'respaldo');
  assert.equal(res.receipt.action, 'respaldar');
  assert.equal(res.receipt.authority.approval, 'preauthorized');

  // El recibo lleva el número de archivos, los bytes y la huella del manifiesto.
  assert.equal(res.output.archivos, 5);
  assert.ok(res.output.bytes > 64 * 1024);
  assert.equal(res.output.huella, res.receipt.evidence.planDigest);
  assert.match(res.receipt.verification.reason, /5 archivos/);
  assert.match(res.receipt.verification.reason, new RegExp(`${res.output.bytes} bytes`));
  assert.match(res.receipt.verification.reason, new RegExp(res.output.huella));
  assert.deepEqual(res.receipt.coverage.sort(), ['esElManifiestoDelRecibo', 'hayArchivos', 'manifiestoIntacto', 'sinCambios', 'sinFaltantes']);

  assert.ok(fs.existsSync(path.join(destino, 'lore/identidad.md')));
  assert.equal(rutas(leerManifiesto(destino)).length, 5);
});

test('RS1.11 un destino que la autoridad no nombra vuelve a la persona y no copia nada', async () => {
  const origen = jardin(raiz('origen'));
  const autorizado = raiz('autorizado');
  const prohibido = raiz('prohibido');
  const cap = respaldoCapability({ origen, destino: prohibido });

  const op = createOperation({
    goal: 'respaldar el jardín',
    action: 'respaldar',
    authority: { spend: [{ asset: 'respaldo:carpeta', maxAmount: '1', to: autorizado }] },
  });
  const res = await runOperation(op, cap, { verify: crearVerificador({ destino: autorizado }), ask: async () => ({ approved: false, by: 'andres' }) });

  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.equal(res.receipt.status, 'needs_human_decision');
  assert.equal(res.receipt.authority.approval, 'human_gate_rejected');
  assert.equal(typeof res.receipt.exit, 'string');
  assert.equal(res.output, null);
  assert.deepEqual(fs.readdirSync(prohibido), [], 'no se escribió nada en el destino no autorizado');
  assert.deepEqual(fs.readdirSync(autorizado), []);
});

test('RS1.12 sin destino en la capacidad, el destino lo nombra la autoridad', async () => {
  const origen = jardin(raiz('origen'));
  const destino = raiz('destino');
  const cap = respaldoCapability({ origen });
  assert.deepEqual(cap.required(createOperation({ goal: 'g', authority: { spend: [{ asset: 'respaldo:carpeta', maxAmount: '1', to: destino }] } })), {
    spend: [{ asset: 'respaldo:carpeta', amount: '1', to: destino }],
  });

  const op = createOperation({
    goal: 'respaldar el jardín',
    authority: { spend: [{ asset: 'respaldo:carpeta', maxAmount: '1', to: destino }] },
  });
  const res = await runOperation(op, cap, { verify: crearVerificador({ destino }), ask: async () => ({ approved: false, by: 'andres' }) });

  assert.equal(res.status, STATES.SUCCEEDED);
  assert.equal(res.output.destino, destino);
  assert.equal(res.output.copiados, 5);
});

test('RS1.13 sin ningún destino nombrado por la autoridad, la operación vuelve a la persona', async () => {
  const origen = jardin(raiz('origen'));
  const cap = respaldoCapability({ origen });
  const op = createOperation({ goal: 'respaldar el jardín', authority: { spend: [] } });

  assert.deepEqual(cap.required(op), { spend: [] });
  const res = await runOperation(op, cap, { verify: crearVerificador({ destino: raiz('nadie') }), ask: async () => ({ approved: false, by: 'andres' }) });
  assert.equal(res.status, STATES.NEEDS_DECISION);
  assert.equal(res.receipt.detail, undefined);
  assert.equal(typeof res.receipt.exit, 'string');
});

test('RS1.14 el recibo no dice verificado si el manifiesto del destino no es el que se respaldó', async () => {
  const origen = jardin(raiz('origen'));
  const otroOrigen = raiz('otro-origen');
  const uno = raiz('uno');
  const otro = raiz('otro');
  escribir(otroOrigen, 'a.txt', 'un árbol distinto');
  await respaldar({ origen: otroOrigen, destino: otro });

  const op = createOperation({
    goal: 'respaldar el jardín',
    authority: { spend: [{ asset: 'respaldo:carpeta', maxAmount: '1', to: uno }] },
  });
  const res = await runOperation(op, respaldoCapability({ origen, destino: uno }), {
    verify: crearVerificador({ destino: otro }),
    ask: async () => ({ approved: false, by: 'andres' }),
  });

  assert.equal(res.status, STATES.NOT_VERIFIED);
  assert.equal(res.receipt.status, 'not_verified');
  assert.equal(res.receipt.verification.verified, false);
  assert.match(res.receipt.verification.reason, /manifiesto/i);
  assert.equal(res.output, null, 'lo no verificado no se le devuelve a la persona como si fuera cierto');
});

test('RS1.15 el respaldo se detiene si el kernel aborta la operación y no afirma nada', async () => {
  const origen = jardin(raiz('origen'));
  const destino = raiz('destino');
  const cap = respaldoCapability({ origen, destino });
  const controller = new AbortController();
  controller.abort();

  const r = await cap.perform({
    operation: { id: 'op-1', goal: 'g' },
    authority: { spend: [{ asset: 'respaldo:carpeta', maxAmount: '1', to: destino }] },
    signal: controller.signal,
  });

  assert.equal(r.ok, false);
  assert.equal(r.settlementUnknown, true, 'un respaldo a medias no se afirma ni se desmiente');
  assert.equal(fs.existsSync(path.join(destino, 'manifiesto.json')), false);
});

test('RS1.16 respaldar con un origen que no es una carpeta lo dice y no escribe nada', async () => {
  const destino = raiz('destino');
  const archivo = escribir(raiz('suelto'), 'solo-un-archivo.txt', 'x');

  await assert.rejects(respaldar({ origen: path.join(archivo, 'no-existe'), destino }), /origen/);
  await assert.rejects(respaldar({ origen: archivo, destino }), /origen no es una carpeta/);
  assert.deepEqual(fs.readdirSync(destino), []);
});

test('RS1.17 dondeEsta y restaurar sin manifiesto responden que no hay copia, sin inventar', async () => {
  const vacio = raiz('vacio');

  assert.equal((await dondeEsta({ destino: vacio, nombre: 'logo' })).hayCopia, false);
  assert.equal((await restaurar({ destino: vacio, archivo: 'logo.png', a: path.join(vacio, 'fuera.png') })).ok, false);
  assert.equal(fs.existsSync(path.join(vacio, 'fuera.png')), false);
});
