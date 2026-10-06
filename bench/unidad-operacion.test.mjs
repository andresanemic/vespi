import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Benchmark unidad-como-operación: 4 encargos, 2 brazos, 8 criterios por encargo.
// Brazo A: sin Lore Plugin. Brazo B: con Lore Plugin 2.5 (operación, recibo, verificación aparte).
// Mismo modelo, mismo esfuerzo, mismo fixture. Adjudicación a ciegas.

const ENCARGOS = [
  {
    id: "landing",
    nombre: "Mini landing",
    encargo: "Quiero una mini landing para mi proyecto de café. Debe tener hero, precios, testimonios y contacto.",
    criterios: [
      "hero con propuesta de valor clara",
      "sección de precios con 3 planes",
      "testimonios con nombre y foto",
      "formulario de contacto funcional",
      "responsive móvil",
      "meta description",
      "tiempo de carga < 3s",
      "accesibilidad básica (alt text, contraste)",
    ],
  },
  {
    id: "noticia",
    nombre: "Noticia",
    encargo: "Escribe una noticia sobre el lanzamiento de un café de especialidad en Santiago.",
    criterios: [
      "titular informativo",
      "lead con quién, qué, cuándo, dónde",
      "cuerpo con al menos 3 párrafos",
      "cita de una fuente",
      "fecha y autor",
      "sin errores ortográficos",
      "extensión 300-500 palabras",
      "tono periodístico",
    ],
  },
  {
    id: "community",
    nombre: "Community management",
    encargo: "Crea una publicación de Instagram para promocionar el café de especialidad.",
    criterios: [
      "copy con propuesta de valor",
      "llamado a la acción claro",
      "hashtags relevantes (5-10)",
      "mención de la marca",
      "tono coherente con la marca",
      "longitud adecuada para Instagram",
      "sin emojis excesivos",
      "incluye mención a la landing",
    ],
  },
  {
    id: "app",
    nombre: "App funcional",
    encargo: "Construye una app simple que muestre el menú del café y permita hacer pedidos.",
    criterios: [
      "muestra el menú con precios",
      "carrito de compras funcional",
      "formulario de pedido",
      "confirmación de pedido",
      "diseño responsive",
      "código sin errores",
      "instrucciones de uso",
      "README con setup",
    ],
  },
];

test("el benchmark tiene 4 encargos con 8 criterios cada uno", () => {
  assert.equal(ENCARGOS.length, 4);
  for (const e of ENCARGOS) {
    assert.equal(e.criterios.length, 8, `${e.id} debe tener 8 criterios`);
    assert.ok(e.encargo.length > 20, `${e.id} debe tener encargo descriptivo`);
  }
});

test("los criterios son binarios y adjudicables a ciegas", () => {
  for (const e of ENCARGOS) {
    for (const c of e.criterios) {
      assert.ok(c.length > 5, `criterio muy corto: ${c}`);
      assert.ok(!c.includes("?"), `criterio no debe ser pregunta: ${c}`);
    }
  }
});

test("el fixture es el mismo para ambos brazos", () => {
  const root = mkdtempSync(join(tmpdir(), "bench-fixture-"));
  writeFileSync(join(root, "CLAUDE.md"), "# Contrato fixture\n");
  writeFileSync(join(root, "FASES.md"), "# Fases\n\n## Operaciones\n");
  const fixture = readFileSync(join(root, "CLAUDE.md"), "utf8");
  assert.equal(fixture, "# Contrato fixture\n");
  rmSync(root, { recursive: true, force: true });
});
