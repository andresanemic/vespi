'use strict';

// RS1 — respaldo como capacidad de Vespi: { id, required(op), perform(ctx) }.
//
// El núcleo sigue sin saber qué es esto (ver src/operation.js, líneas 4-8: la capacidad es
// una función con forma, nada más). Acá hay dos reglas que son del contrato, no del código:
//
// 1. La AUTORIDAD nombra el destino. `required` declara el gasto como { asset, amount, to } con
//    `to` = la carpeta de destino, así que el kernel decide si hay quién lo autorizó. Un respaldo
//    a una carpeta que la autoridad no nombra nunca llega a perform: cae en la puerta humana y
//    vuelve a la persona.
// 2. El recibo se sostiene solo. perform entrega la huella del manifiesto como evidencia, y el
//    verificador de abajo es la `verify` que recalcula las huellas de verdad: si el destino no
//    respalda lo que el recibo afirma, el estado es not_verified, no verified.

const path = require('node:path');
const { respaldar, verificar } = require('./nucleo.js');

const ACTIVO = 'respaldo:carpeta';
const CANTIDAD = '1';

function esTexto(valor) {
  return typeof valor === 'string' && valor.length > 0;
}

// El destino que la autoridad nombra: un grant del activo de respaldo con su `to`.
function destinoNombrado(authority) {
  try {
    const grants = authority && authority.spend;
    if (!Array.isArray(grants)) return null;
    const grant = grants.find((g) => g && g.asset === ACTIVO && esTexto(g.to));
    return grant ? path.resolve(grant.to) : null;
  } catch {
    return null;
  }
}

function autoridadAutoriza(authority, destino) {
  try {
    const grants = authority && authority.spend;
    if (!Array.isArray(grants)) return false;
    return grants.some((g) => g && g.asset === ACTIVO && esTexto(g.to) && path.resolve(g.to) === destino);
  } catch {
    return false;
  }
}

function respaldoCapability({ origen, destino, excluir } = {}) {
  const pedido = esTexto(destino) ? path.resolve(destino) : null;

  return {
    id: 'respaldo',

    // Lo que se pidió, o lo que nombra la autoridad si nadie pidió nada.
    required: (op) => {
      const alvo = pedido || destinoNombrado(op && op.authority);
      return { spend: alvo ? [{ asset: ACTIVO, amount: CANTIDAD, to: alvo }] : [] };
    },

    perform: async (ctx) => {
      const authority = ctx && ctx.authority;
      const alvo = pedido || destinoNombrado(authority);
      if (!alvo) {
        return { ok: false, error: 'no hay ningún destino: ni lo pidió la persona ni lo nombra la autoridad' };
      }
      if (!autoridadAutoriza(authority, alvo)) {
        return { ok: false, error: `la autoridad no nombra ${alvo} como destino de respaldo` };
      }
      try {
        const resultado = await respaldar({
          origen,
          destino: alvo,
          excluir,
          signal: ctx && ctx.signal,
        });
        return {
          ok: true,
          evidence: {
            operationId: (ctx && ctx.operation && ctx.operation.id) || null,
            status: 'respaldo_completo',
            type: 'carpeta',
            // La lista de valores que el núcleo admite en `evidence` es fija; la huella de lo
            // que esta capacidad produjo viaja en `planDigest`, el mismo lugar donde x402
            // deja la huella de lo que entregó. El número de archivos y los bytes van en
            // verification.reason y en el output, que sí los conservan enteros.
            planDigest: resultado.huella,
          },
          output: {
            origen: resultado.origen,
            destino: resultado.destino,
            archivos: resultado.archivos,
            copiados: resultado.copiados,
            sinCambios: resultado.sinCambios,
            excluidos: resultado.excluidos,
            bytes: resultado.bytes,
            huella: resultado.huella,
            manifiesto: resultado.manifiesto,
            generado: resultado.generado,
          },
        };
      } catch (error) {
        const abortado = error && error.code === 'RESPALDO_ABORTADO';
        return {
          ok: false,
          // A medias no se afirma ni se desmiente: el estado honesto es not_verified.
          settlementUnknown: abortado,
          error: abortado ? error.message : `el respaldo falló: ${error && error.message ? error.message : String(error)}`,
        };
      }
    },
  };
}

// La `verify` que se le pasa a runOperation. Recalcula las huellas de lo que está en el destino
// y las compara con la huella que el recibo afirma. `checks` es toda de booleanos a propósito:
// el núcleo cuenta cobertura por `checks[key] === true`, así que un número ahí se leería como
// una comprobación fallada.
function crearVerificador({ destino } = {}) {
  const donde = esTexto(destino) ? path.resolve(destino) : null;
  return async (evidence) => {
    if (!donde) return { verified: false, checks: {}, reason: 'no hay destino contra el cual verificar' };
    let estado;
    try {
      estado = await verificar({ destino: donde });
    } catch (error) {
      return {
        verified: false,
        checks: {},
        reason: `la verificación no pudo correr: ${error && error.message ? error.message : String(error)}`,
      };
    }

    const huellaAfirmada = evidence && esTexto(evidence.planDigest) ? evidence.planDigest : null;
    const checks = {
      hayArchivos: estado.archivos > 0,
      manifiestoIntacto: estado.manifiestoIntacto === true,
      sinCambios: estado.cambiaron.length === 0,
      sinFaltantes: estado.faltan.length === 0,
      esElManifiestoDelRecibo: huellaAfirmada !== null && huellaAfirmada === estado.huella,
    };
    const verificado = Object.values(checks).every((c) => c === true);

    const reason = verificado
      ? `${estado.archivos} archivos, ${estado.bytes} bytes, huella ${estado.huella}`
      : `el destino ${donde} no respalda lo que este recibo afirma`
        + ` (el manifiesto del destino tiene ${estado.archivos} archivos con huella ${estado.huella}`
        + `; el recibo dice ${huellaAfirmada === null ? 'ninguna' : huellaAfirmada}`
        + `; ${estado.cambiaron.length} alterados, ${estado.faltan.length} faltantes)`;

    return { verified: verificado, checks, reason };
  };
}

module.exports = { ACTIVO, respaldoCapability, crearVerificador };
