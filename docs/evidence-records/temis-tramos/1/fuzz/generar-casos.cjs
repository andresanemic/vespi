'use strict';
// Genera casos al azar (semilla fija) y los canonicaliza con src/canonical.js. El verificador independiente
// (verificar.py) los recalcula sin compartir codigo y compara bytes y digests.
const fs = require('node:fs');
const path = require('node:path');
const cf = require('../../../src/canonical.js');

let estado = 20261002;
const rnd = () => { estado = (estado * 1664525 + 1013904223) >>> 0; return estado / 2 ** 32; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

// Puntos de codigo asignados que ejercitan el orden UTF-8 frente al UTF-16, NFC y los escapes.
const piezas = ['a', 'Z', '0', ' ', '"', '\\', '/', '\u0001', '\u001f', '\u007f', 'é', 'é', 'ñ', 'ñ',
  'Α', '€', ' ', '', '', 'ﬁ', '�', '\u{10000}', '\u{1f600}', '\u{1d11e}', '\u{2f800}',
  '가', '가', 'Å', 'Å', 'Å', '̈́', 'ཱི'];
const cadena = () => { let s = ''; const n = Math.floor(rnd() * 5); for (let i = 0; i < n; i++) s += pick(piezas); return s; };
const entero = () => { const t = Math.floor(rnd() * 5); if (t === 0) return 0n; if (t === 1) return -(BigInt(Math.floor(rnd() * 1e9))); if (t === 2) return 9223372036854775807n; if (t === 3) return -9223372036854775808n; return BigInt(Math.floor(rnd() * 1e12)); };
function valor(prof) {
  const t = Math.floor(rnd() * (prof > 3 ? 4 : 7));
  if (t === 0) return cadena();
  if (t === 1) return entero();
  if (t === 2) return rnd() < 0.5;
  if (t === 3) return null;
  if (t === 4 || t === 5) { const o = {}; const n = Math.floor(rnd() * 5); for (let i = 0; i < n; i++) o[cadena() + String(i)] = valor(prof + 1); return o; }
  const a = []; const n = Math.floor(rnd() * 4); for (let i = 0; i < n; i++) a.push(valor(prof + 1)); return a;
}

const casos = [];
for (let i = 0; i < 400; i++) {
  const v = { raiz: valor(0), k: cadena() + 'x', n: entero() };
  let texto;
  try { texto = JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `@@${x}@@` : x)).replace(/"@@(-?\d+)@@"/g, '$1'); } catch { continue; }
  let canonico, digest;
  try { canonico = cf.canonicalizar(cf.parseTexto(texto)); digest = cf.digestDeTexto(texto); } catch (e) { casos.push({ texto, error: String(e.message) }); continue; }
  casos.push({ texto, canonicoHex: Buffer.from(canonico, 'utf8').toString('hex'), digest });
}
fs.writeFileSync(path.join(__dirname, 'casos.json'), JSON.stringify(casos));
console.log('casos', casos.length, 'con error', casos.filter((c) => c.error).length);
