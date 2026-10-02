# respaldo — la copia del jardín como capacidad de Vespi

> Fila R51 de `candidatas-rc4.md`. Vive **fuera** del núcleo (`src/`), igual que `demo/x402`:
> el kernel nunca importa una capacidad. CommonJS, sin dependencias: `node:fs`, `node:crypto`,
> `node:path`.

Si una persona o un trabajador pierde su computador, lo que hay en su jardín —el Lore, pero
también sitios, imágenes, videos— tiene que poder recuperarse, y Vespi tiene que poder responder
con sensatez **dónde está la última copia** y devolverla.

## La forma elegida: una carpeta

El destino es una **carpeta**, no una API. Es la forma más simple que funciona sin claves de
terceros:

- la carpeta que **Google Drive, Dropbox o OneDrive ya sincronizan** en ese computador, o
- un disco externo.

La sincronización ya está andando, con sus credenciales y sus reglas. Esta capacidad no pide
ninguna clave nueva y no habla con ningún servicio: escribe archivos en un directorio, y el
servicio que ya estaba ahí se encarga del resto. Subir por la API de cada uno queda para después.

## Cómo se usa

### Como capacidad (dentro de `runOperation`)

La **autoridad nombra el destino**. No es una preferencia de la capacidad: el `to` del grant es la
carpeta, y `required()` la declara como gasto, así que el kernel decide si hay quién la autorizó.

```js
const { createOperation, runOperation } = require('../../src/operation.js');
const { respaldoCapability, crearVerificador } = require('./index.js');

const destino = 'D:/Drive/Mi Computador/jardin';   // la carpeta que Drive ya sincroniza

const cap = respaldoCapability({ origen: 'C:/Claude/founder', destino });
const op = createOperation({
  goal: 'respaldar el jardín antes de cambiar de computador',
  action: 'respaldar',
  authority: { spend: [{ asset: 'respaldo:carpeta', maxAmount: '1', to: destino }] },
});

const res = await runOperation(op, cap, {
  verify: crearVerificador({ destino }),   // recalcula las huellas de verdad
  ask: (requisitos) => preguntarALaPersona(requisitos),
});
```

- Si la autoridad nombra esa carpeta: el respaldo corre y el recibo queda `verified` solo si
  `verificar` encuentra todo íntegro **y** el manifiesto del destino es el que el recibo afirma.
- Si se pide una carpeta que la autoridad no nombra: la puerta humana se abre, la operación termina
  en `needs_human_decision` con su `exit`, y **no se copia nada**. No hay atajo: `perform` además
  vuelve a comprobar la autorización, aunque el kernel ya lo hizo.
- Si el kernel aborta la operación, el respaldo se detiene y el estado es `not_verified`: a medias
  no se afirma ni se desmiente.

El recibo lleva el número de archivos, los bytes y la huella del manifiesto: la huella viaja en
`evidence.planDigest` (la lista de valores que el núcleo admite en `evidence` es fija; ese es el
mismo lugar donde x402 deja la huella de lo que entregó) y el número de archivos y los bytes van en
`verification.reason` y en `output`. Los `verification.checks` son **todos booleanos** a propósito:
el núcleo cuenta cobertura por `checks[key] === true`, así que un número ahí se leería como una
comprobación fallida.

### Como función (fuera del kernel)

```js
const { respaldar, verificar, restaurar, dondeEsta } = require('./index.js');

await respaldar({ origen, destino, excluir: ['tmp', 'assets/borrador'] });

verificar({ destino });                                   // { ok, integros, cambiaron, faltan }
restaurar({ destino, archivo: 'lore/identidad.md', a: 'C:/recuperado/identidad.md' });
restaurar({ destino, archivo: 'assets', a: 'C:/recuperado' });   // la carpeta completa
dondeEsta({ destino, nombre: 'clip' });                   // dónde está la última copia
```

## Lo que sí hace

- Copia el árbol entero, **incluidos binarios**: imágenes, videos, PDF. Se copian por flujo, no se
  cargan en memoria, así que un video de un gigabyte no revienta el proceso.
- **Incremental**: solo escribe lo nuevo o lo cambiado, comparando la huella SHA-256. Si el origen
  no cambió de tamaño ni de fecha, no se vuelve a leer siquiera.
- Escribe `manifiesto.json` en el destino con cada archivo, su tamaño, su huella y su fecha.
- **Nunca borra nada del destino.** Si un archivo se borra del origen, su copia sigue ahí; el
  manifiesto describe el árbol de ahora, no el de antes.
- Excluye siempre `node_modules` y `.git`, más lo que se le pase en `excluir` (un nombre de
  carpeta, de archivo, o un camino relativo dentro del origen).
- `verificar` recalcula todas las huellas y dice qué está íntegro, qué cambió y qué falta. También
  avisa si el **manifiesto mismo** fue editado a mano.
- `restaurar` comprueba la huella de la copia **antes** de devolverla, y nunca sobrescribe un
  archivo que ya existe sin `sobrescribir: true`. Si algo falla, no deja media restauración.
- `dondeEsta` busca por nombre parcial (no distingue mayúsculas) sobre la ruta completa y responde
  con la última copia, o dice que no hay copia.

## Lo que NO hace todavía, y por qué

- **No sube por la API de Drive, Dropbox ni OneDrive.** La forma elegida es la carpeta que esos
  servicios ya sincronizan: no hace falta ninguna clave de terceros, ni OAuth, ni tokens que
  expiren, ni manejo de cuotas. Subir por API es un trabajo aparte, con su propia autorización y sus
  propios riesgos; hoy no está.
- **No cifra nada.** Los archivos se copian tal cual. Una copia sin cifrar fuera del equipo expone
  criterio y datos. El cifrado quedó fuera de RC4 a propósito (tensión declarada en R51) y se decide
  con Andrés: si la copia es solo local, si vuelve el cifrado únicamente para esto, o si se
  recomienda un repositorio privado. **Mientras tanto: la carpeta de destino es la que la persona
  eligió, y sólo ella tiene acceso.**
- **No hace versiones ni retención.** Una copia es una copia; si dos respaldos pisan el mismo
  archivo, gana el más nuevo. El historial de cambios no está.
- **No sabe de permisos, cuotas ni conflictos de sincronización.** Si el destino está lleno, o el
  servicio de sincronización está en pausa, o hay un conflicto, esto no lo ve.
- **No sigue enlaces simbólicos.** Un enlace puede apuntar afuera y hacer un ciclo; no se sigue y
  queda anotado en `excluidos`.
- **Una carpeta vacía se crea pero no se anota en el manifiesto**, así que `restaurar` no la
 devuelve. Las carpetas con archivos sí se devuelven enteras.

### Un detalle honesto del incremental

"Atajo" significa que, si un archivo del origen cambia de contenido **sin** cambiar de tamaño ni de
fecha, la segunda pasada lo toma por bueno. Es el mismo criterio de `rsync` por defecto, y es lo que
hace que repetir el respaldo sea barato. Para eso está `verificar`: recalcula las huellas de verdad
y es el que dice si el destino está íntegro. Si la carpeta se sospecha pisada, `verificar` antes de
confiar.

## Las pruebas

```sh
node --test test/respaldo.test.js
```

17 pruebas: copia de texto y binarios con bytes al azar, incremental, exclusiones, la verificación
que detecta un archivo alterado, uno faltante y un manifiesto editado, la restauración que no
sobrescribe, la que se niega a devolver una copia no íntegra, `dondeEsta`, y la capacidad corriendo
dentro de `runOperation` con destino autorizado, no autorizado, sin destino nombrado, con manifiesto
que no corresponde, abortada, y con origen inexistente.
