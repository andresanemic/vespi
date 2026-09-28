'use strict';

// RS1 — el respaldo del jardín (fila R51 de candidatas-rc4.md).
//
// Esto vive AFUERA del núcleo, como demo/x402 vive afuera: el kernel nunca importa una
// capacidad. Acá solo hay sistema de archivos, huellas y truthful sobre lo que se copió.
//
// La forma elegida por el orquestador es la más simple que funciona sin claves de terceros:
// el destino es una CARPETA (la que Drive, Dropbox o OneDrive ya sincronizan, o un disco
// externo). Dos reglas que no se negocian: nunca se borra nada del destino, y nada se afirma
// que no se haya comprobado con una huella.

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');

const EXCLUIDOS_POR_DEFECTO = Object.freeze(['node_modules', '.git']);
const NOMBRE_MANIFIESTO = 'manifiesto.json';
const VERSION_MANIFIESTO = 1;

function esTexto(valor) {
  return typeof valor === 'string' && valor.length > 0;
}

function aPosix(valor) {
  return String(valor).split(path.sep).join('/');
}

// Una exclusión puede nombrarse como carpeta, como archivo o como camino relativo dentro del
// origen ('tmp', 'cache.bin', 'assets/videos'). Se comparan las tres formas.
function normalizarPatron(valor) {
  return aPosix(valor).replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function listaDePatrones(excluir) {
  const patrones = EXCLUIDOS_POR_DEFECTO.map(normalizarPatron);
  if (excluir === undefined || excluir === null) return patrones;
  const extra = Array.isArray(excluir) ? excluir : [excluir];
  for (const uno of extra) {
    if (esTexto(uno)) {
      const patron = normalizarPatron(uno);
      if (!patrones.includes(patron)) patrones.push(patron);
    }
  }
  return patrones;
}

function estaExcluido(rel, patrones, destinoRelativo) {
  for (const patron of patrones) {
    if (rel === patron || rel.startsWith(`${patron}/`) || rel.split('/').pop() === patron) return true;
  }
  // Un destino dentro del origen no se copia dentro de sí mismo.
  if (destinoRelativo) {
    if (rel === destinoRelativo || rel.startsWith(`${destinoRelativo}/`)) return true;
  }
  return false;
}

function relativoSiEstaDentro(de, dentro) {
  const rel = path.relative(de, dentro);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return aPosix(rel);
}

async function recorrer(origenAbsoluto, patrones, destinoRelativo) {
  const archivos = [];
  const carpetas = [];
  const excluidos = [];

  async function entrar(directorioAbsoluto, prefijo) {
    let entradas;
    try {
      entradas = await fs.promises.readdir(directorioAbsoluto, { withFileTypes: true });
    } catch (error) {
      throw new Error(`no se pudo leer ${directorioAbsoluto}: ${error.message}`);
    }
    entradas.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entrada of entradas) {
      const rel = prefijo ? `${prefijo}/${entrada.name}` : entrada.name;
      if (estaExcluido(rel, patrones, destinoRelativo)) {
        excluidos.push({ ruta: rel, motivo: 'excluido' });
        continue;
      }
      const absoluto = path.join(directorioAbsoluto, entrada.name);
      if (entrada.isSymbolicLink()) {
        // Un enlace puede apuntar afuera y hacer un ciclo: no se sigue, se dice.
        excluidos.push({ ruta: rel, motivo: 'enlace simbólico' });
      } else if (entrada.isDirectory()) {
        carpetas.push(rel);
        await entrar(absoluto, rel);
      } else if (entrada.isFile()) {
        archivos.push({ rel, absoluto });
      } else {
        excluidos.push({ ruta: rel, motivo: 'no es un archivo' });
      }
    }
  }

  await entrar(origenAbsoluto, '');
  return { archivos, carpetas, excluidos };
}

// La huella se calcula por partes: un video de un gigabyte no cabe en memoria.
function huellaDe(rutaAbsoluta) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const flujo = fs.createReadStream(rutaAbsoluta);
    flujo.on('error', reject);
    flujo.on('data', (trozo) => hash.update(trozo));
    flujo.on('end', () => resolve(hash.digest('hex')));
  });
}

function copiar(origenAbsoluta, destinoAbsoluta) {
  return new Promise((resolve, reject) => {
    fs.promises.mkdir(path.dirname(destinoAbsoluta), { recursive: true }).then(() => {
      const fuente = fs.createReadStream(origenAbsoluta);
      const sumidero = fs.createWriteStream(destinoAbsoluta);
      fuente.on('error', reject);
      sumidero.on('error', reject);
      sumidero.on('finish', resolve);
      fuente.pipe(sumidero);
    }, reject);
  });
}

async function leerManifiesto(destinoAbsoluto) {
  try {
    const crudo = await fs.promises.readFile(path.join(destinoAbsoluto, NOMBRE_MANIFIESTO), 'utf8');
    const manifiesto = JSON.parse(crudo);
    if (!manifiesto || typeof manifiesto !== 'object' || !Array.isArray(manifiesto.archivos)) return null;
    return manifiesto;
  } catch {
    return null;
  }
}

// La huella del manifiesto cubre QUÉ hay (ruta, tamaño, huella), no CUÁNDO:
// así el mismo manifiesto sobrevive a que la carpeta sincronizada lo copie a otra máquina.
function huellaDeManifiesto(archivos) {
  const lista = archivos
    .map((a) => ({ ruta: a.ruta, bytes: a.bytes, huella: a.huella }))
    .sort((x, y) => (x.ruta < y.ruta ? -1 : x.ruta > y.ruta ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(lista), 'utf8').digest('hex');
}

function errorDeAborto(where) {
  const error = new Error(`respaldo detenido: ${where}`);
  error.code = 'RESPALDO_ABORTADO';
  return error;
}

function lanzarSiAbortado(signal, where) {
  if (signal && signal.aborted) throw errorDeAborto(where);
}

// Copia el árbol de origen al destino, sólo lo nuevo o lo cambiado, y deja el manifiesto.
// Nunca borra nada del destino. `signal` es opcional (lo usa el kernel para abortar).
async function respaldar({ origen, destino, excluir, signal } = {}) {
  if (!esTexto(origen)) throw new Error('respaldar necesita un origen');
  if (!esTexto(destino)) throw new Error('respaldar necesita un destino');
  const origenAbsoluto = path.resolve(origen);
  const destinoAbsoluto = path.resolve(destino);

  const statOrigen = await fs.promises.stat(origenAbsoluto).catch(() => null);
  if (!statOrigen || !statOrigen.isDirectory()) {
    throw new Error(`el origen no es una carpeta: ${origenAbsoluto}`);
  }
  lanzarSiAbortado(signal, 'antes de empezar');
  await fs.promises.mkdir(destinoAbsoluto, { recursive: true });

  const patrones = listaDePatrones(excluir);
  const destinoRelativo = relativoSiEstaDentro(origenAbsoluto, destinoAbsoluto);
  const { archivos: hallados, carpetas, excluidos } = await recorrer(origenAbsoluto, patrones, destinoRelativo);
  const previo = await leerManifiesto(destinoAbsoluto);
  const antes = new Map((previo && previo.archivos ? previo.archivos : []).map((a) => [a.ruta, a]));

  // Las carpetas vacías también se crean: la estructura del jardín se conserva.
  for (const carpeta of carpetas) {
    await fs.promises.mkdir(path.join(destinoAbsoluto, ...carpeta.split('/')), { recursive: true });
  }

  const registro = [];
  const rutas = [];
  let copiados = 0;
  let sinCambios = 0;
  let bytes = 0;

  for (const item of hallados) {
    lanzarSiAbortado(signal, item.rel);
    const stat = await fs.promises.stat(item.absoluto);
    bytes += stat.size;
    const enDestino = path.join(destinoAbsoluto, ...item.rel.split('/'));
    const statDestino = await fs.promises.stat(enDestino).catch(() => null);
    const anterior = antes.get(item.rel);

    // Atajo honesto del incremental: si el origen no cambió de tamaño ni de fecha, la huella
    // que ya anotamos sigue valiendo y no hay ni que leerlo.
    let hash = null;
    if (anterior && esTexto(anterior.huella) && anterior.bytes === stat.size && anterior.mtimeMs === stat.mtimeMs) {
      hash = anterior.huella;
    } else {
      hash = await huellaDe(item.absoluto);
    }

    const yaEsta = Boolean(anterior && anterior.huella === hash && anterior.bytes === stat.size
      && statDestino && statDestino.isFile() && statDestino.size === stat.size);
    if (yaEsta) {
      sinCambios += 1;
    } else {
      await copiar(item.absoluto, enDestino);
      copiados += 1;
      rutas.push(item.rel);
    }

    registro.push({
      ruta: item.rel,
      bytes: stat.size,
      huella: hash,
      fecha: new Date(stat.mtimeMs).toISOString(),
      mtimeMs: stat.mtimeMs,
    });
  }

  const manifiesto = {
    version: VERSION_MANIFIESTO,
    generado: new Date().toISOString(),
    origen: origenAbsoluto,
    archivos: registro,
    total_archivos: registro.length,
    total_bytes: bytes,
    huella: huellaDeManifiesto(registro),
  };
  const rutaManifiesto = path.join(destinoAbsoluto, NOMBRE_MANIFIESTO);
  await fs.promises.writeFile(rutaManifiesto, `${JSON.stringify(manifiesto, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    origen: origenAbsoluto,
    destino: destinoAbsoluto,
    archivos: registro.length,
    copiados,
    rutas,
    sinCambios,
    excluidos,
    bytes,
    huella: manifiesto.huella,
    manifiesto: rutaManifiesto,
    generado: manifiesto.generado,
  };
}

// Recalcula las huellas de lo que está en el destino y dice qué está íntegro, qué cambió y qué falta.
async function verificar({ destino } = {}) {
  if (!esTexto(destino)) throw new Error('verificar necesita un destino');
  const destinoAbsoluto = path.resolve(destino);
  const manifiesto = await leerManifiesto(destinoAbsoluto);
  if (!manifiesto) {
    return {
      ok: false,
      destino: destinoAbsoluto,
      integros: [],
      cambiaron: [],
      faltan: [],
      archivos: 0,
      bytes: 0,
      huella: null,
      manifiestoIntacto: false,
      motivo: `no hay ${NOMBRE_MANIFIESTO} en ${destinoAbsoluto}: no hay nada que verificar`,
    };
  }

  const integros = [];
  const cambiaron = [];
  const faltan = [];
  let bytes = 0;
  for (const entrada of manifiesto.archivos) {
    const absoluto = path.join(destinoAbsoluto, ...String(entrada.ruta).split('/'));
    const stat = await fs.promises.stat(absoluto).catch(() => null);
    if (!stat || !stat.isFile()) {
      faltan.push(entrada.ruta);
      continue;
    }
    const hash = await huellaDe(absoluto);
    if (hash === entrada.huella) {
      integros.push(entrada.ruta);
      bytes += entrada.bytes;
    } else {
      cambiaron.push(entrada.ruta);
    }
  }

  const manifiestoIntacto = huellaDeManifiesto(manifiesto.archivos) === manifiesto.huella;
  return {
    ok: manifiestoIntacto && cambiaron.length === 0 && faltan.length === 0,
    destino: destinoAbsoluto,
    integros,
    cambiaron,
    faltan,
    archivos: manifiesto.archivos.length,
    bytes,
    huella: manifiesto.huella,
    manifiestoIntacto,
    generado: esTexto(manifiesto.generado) ? manifiesto.generado : null,
  };
}

// Devuelve un archivo o una carpeta del respaldo a donde se pida, previa comprobación de su huella.
async function restaurar({ destino, archivo, a, sobrescribir } = {}) {
  if (!esTexto(destino)) throw new Error('restaurar necesita un destino');
  if (!esTexto(archivo)) throw new Error('restaurar necesita saber qué archivo devolver');
  if (!esTexto(a)) throw new Error('restaurar necesita un sitio de destino `a`');
  const destinoAbsoluto = path.resolve(destino);
  const pedido = normalizarPatron(archivo);
  const aAbsoluto = path.resolve(a);

  const manifiesto = await leerManifiesto(destinoAbsoluto);
  if (!manifiesto) return { ok: false, error: `no hay ${NOMBRE_MANIFIESTO} en ${destinoAbsoluto}` };

  let candidatos = manifiesto.archivos.filter((x) => x.ruta === pedido || x.ruta.startsWith(`${pedido}/`));
  if (candidatos.length === 0) {
    const porNombre = manifiesto.archivos.filter((x) => x.ruta.split('/').pop() === pedido);
    if (porNombre.length === 1) {
      candidatos = porNombre;
    } else if (porNombre.length > 1) {
      return { ok: false, error: `hay más de una copia con ese nombre: ${porNombre.map((p) => p.ruta).join(', ')}` };
    } else {
      return { ok: false, error: `no hay copia de ${pedido} en ${destinoAbsoluto}` };
    }
  }

  // Una sola coincidencia exacta es un archivo; una coincidencia por prefijo es una carpeta.
  const esCarpeta = candidatos.length > 1 || candidatos[0].ruta !== pedido;
  const statA = await fs.promises.stat(aAbsoluto).catch(() => null);
  let baseCarpeta = aAbsoluto;
  if (!esCarpeta && statA && statA.isDirectory()) baseCarpeta = aAbsoluto;

  // Se calcula y se comprueba todo ANTES de escribir: un fallo no deja media restauración.
  // Al devolver una carpeta se conserva el camino completo desde la raíz del respaldo: `a` recibe
  // `a/assets/logo.png`, nunca `a/logo.png`. Aplanar la carpeta podría pisar, en `a`, archivos sin
  // relación con lo que se pidió.
  const plan = [];
  for (const candidato of candidatos) {
    const destinoFinal = esCarpeta
      ? path.join(aAbsoluto, ...String(candidato.ruta).split('/'))
      : (statA && statA.isDirectory() ? path.join(baseCarpeta, pedido.split('/').pop()) : baseCarpeta);
    const copiaEnRespaldo = path.join(destinoAbsoluto, ...candidato.ruta.split('/'));
    const hash = await huellaDe(copiaEnRespaldo).catch(() => null);
    if (hash === null) return { ok: false, error: `no hay copia de ${candidato.ruta} en ${destinoAbsoluto}` };
    if (hash !== candidato.huella) {
      return {
        ok: false,
        error: `la copia de ${candidato.ruta} ya no está íntegra: su huella no es la del manifiesto, no se devuelve`,
      };
    }
    plan.push({ origen: copiaEnRespaldo, destino: destinoFinal, ruta: candidato.ruta, bytes: candidato.bytes });
  }

  const existentes = plan.filter((p) => fs.existsSync(p.destino));
  if (existentes.length > 0 && sobrescribir !== true) {
    return {
      ok: false,
      yaExiste: true,
      sobrescrito: false,
      error: `ya existe en el sitio de destino: ${existentes.map((p) => p.destino).join(', ')}; no se sobrescribe sin sobrescribir: true`,
    };
  }

  let sobrescrito = false;
  for (const paso of plan) {
    await fs.promises.mkdir(path.dirname(paso.destino), { recursive: true });
    await copiar(paso.origen, paso.destino);
    if (existentes.some((p) => p.destino === paso.destino)) sobrescrito = true;
  }

  return {
    ok: true,
    destino: destinoAbsoluto,
    archivo: pedido,
    carpeta: esCarpeta,
    a: plan[0].destino,
    restaurados: plan.map((p) => p.ruta),
    sobrescrito,
    bytes: plan.reduce((suma, p) => suma + p.bytes, 0),
  };
}

// Dónde está la última copia de algo buscado por nombre parcial, o que no hay copia.
async function dondeEsta({ destino, nombre } = {}) {
  if (!esTexto(nombre)) throw new Error('dondeEsta necesita un nombre');
  const destinoAbsoluto = esTexto(destino) ? path.resolve(destino) : null;
  const manifiesto = destinoAbsoluto ? await leerManifiesto(destinoAbsoluto) : null;
  if (!manifiesto) {
    return {
      ok: true,
      hayCopia: false,
      destino: destinoAbsoluto,
      copias: [],
      ultima: null,
      motivo: `no hay copia de ${nombre}: no hay ${NOMBRE_MANIFIESTO} en ${destinoAbsoluto}`,
    };
  }

  const busqueda = nombre.toLowerCase();
  const copias = manifiesto.archivos
    .filter((x) => String(x.ruta).toLowerCase().includes(busqueda))
    .map((x) => ({
      ruta: x.ruta,
      donde: path.join(destinoAbsoluto, ...String(x.ruta).split('/')),
      bytes: x.bytes,
      fecha: esTexto(x.fecha) ? x.fecha : null,
      huella: esTexto(x.huella) ? x.huella : null,
    }))
    .sort((p, q) => {
      const porFecha = String(q.fecha).localeCompare(String(p.fecha));
      return porFecha !== 0 ? porFecha : p.ruta.localeCompare(q.ruta);
    });

  if (copias.length === 0) {
    return {
      ok: true,
      hayCopia: false,
      destino: destinoAbsoluto,
      copias: [],
      ultima: null,
      motivo: `no hay copia de ${nombre} en ${destinoAbsoluto}`,
    };
  }

  return {
    ok: true,
    hayCopia: true,
    destino: destinoAbsoluto,
    copias,
    ultima: copias[0],
    motivo: `${copias.length === 1 ? 'la copia' : `las ${copias.length} copias`} de ${nombre}: la última está en ${copias[0].donde}`,
  };
}

module.exports = {
  EXCLUIDOS_POR_DEFECTO,
  NOMBRE_MANIFIESTO,
  respaldar,
  verificar,
  restaurar,
  dondeEsta,
};
