# Servine

## Vespi Kernel 0.1.6 · local cut

This cut contains the two local commits after 0.1.5. The skill provenance resolver now preserves every unique declared capability when a duplicate appears before a unique name. A regression test prevents URL checks based on substring matching. The README, judge guide and capability catalog now enter from a single English hero with a separate Spanish box.

No runtime capability was added. The package remains a private source checkout; this note records a local cut and makes no GitHub release claim.

Review. This cut went through a superreview run with the multi-agent code review of Claude Code: five findings, one of them normal (the duplicated capability above), fixed in this cut. Those are our own reviews: there is no independent external security audit. See the [threat model](./THREAT_MODEL.md).

The complete suite result is recorded in [SUITE_RESULT_0.1.6.txt](./SUITE_RESULT_0.1.6.txt).

---

## Vespi Kernel 0.1.6 · corte local

Este corte reúne los dos commits locales posteriores a 0.1.5. El resolver de procedencia conserva cada capacidad declarada única aunque antes aparezca un nombre duplicado. Una regresión impide comprobar URLs mediante coincidencias de subcadenas. El README, la guía para jueces y el catálogo de capacidades comparten ahora una sola entrada en inglés y una caja separada en español.

No se agregó una capacidad de ejecución. El paquete sigue siendo un checkout fuente privado; esta nota registra un corte local y no afirma una release de GitHub.

Revisión. Este corte pasó por una superreview hecha con la revisión de código multiagente de Claude Code: cinco hallazgos, uno normal (la capacidad duplicada de arriba), corregido en este corte. Son revisiones propias: no hay auditoría de seguridad externa independiente. Ver el [modelo de amenazas](./THREAT_MODEL.md#modelo-de-amenazas).

El resultado de la suite completa está en [SUITE_RESULT_0.1.6.txt](./SUITE_RESULT_0.1.6.txt).