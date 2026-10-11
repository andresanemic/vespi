# Threat model

> What the Vespi kernel defends against, what it does not, and how to check it yourself. Español: [Modelo de amenazas](#modelo-de-amenazas).

**Who and what we defend against.** An agent or delegate that acts outside the authority it was granted. A skill or tool that is not the one that was declared. A verifier that is the same party as the actor. A receipt edited after it was written.

**What the kernel does.** Authority is checked before the effect: without a sufficient grant the gate returns `needs_human_decision` and no effect runs. The person's approval is recorded by name (`decidedBy`). Verification is a separate step from the action. The receipt carries a canonical SHA-256 digest, so an edited receipt fails `verifyReceipt`, and it declares what it covered and what it did not (`coverage`, `notCovered`). Skill provenance compares the declared repository, commit and author against a recomputed content digest. Version 0.1.6 closes a gap in which a duplicated declared capability could leave the registered authority incomplete.

**What it does not do.** It does not isolate code: the host and the injected ports are trusted code, not a sandbox, and the host is the reference monitor: without the host's interposition there is no guarantee. The host supplies the clock and stores the receipts. Reported file touches are reported, not enforced. A digest protects integrity, not the identity of whoever approved. A receipt says what was checked, not that the delivered content is true. This cut has no external anchor and no live payment settlement: the walkthrough runs offline, with no network and no money. It has had no external security audit.

**Check it yourself.** `node examples/walkthrough.js` shows the gate, the approval, the separate verification and a receipt with its `notCovered`. The adversarial tests are [`test/t1-adversarial.test.js`](../test/t1-adversarial.test.js) and [`test/skill-provenance-hardening.test.js`](../test/skill-provenance-hardening.test.js).

---

# Modelo de amenazas

> Contra qué defiende el kernel de Vespi, contra qué no, y cómo comprobarlo tú mismo.

**Contra quién y qué defendemos.** Un agente o delegado que actúa fuera de la autoridad que se le dio. Una skill o herramienta que no es la que se declaró. Un verificador que es la misma parte que quien actuó. Un recibo editado después de escrito.

**Qué hace el kernel.** La autoridad se comprueba antes del efecto: sin un permiso suficiente la puerta devuelve `needs_human_decision` y no corre ningún efecto. La aprobación de la persona queda registrada con su nombre (`decidedBy`). La verificación es un paso separado de la acción. El recibo lleva un digest SHA-256 canónico, así que un recibo editado no pasa `verifyReceipt`, y declara qué cubrió y qué no (`coverage`, `notCovered`). La procedencia de una skill compara el repositorio, el commit y el autor declarados con un digest de contenido recalculado. La versión 0.1.6 cierra un hueco en el que una capacidad declarada duplicada podía dejar incompleta la autoridad registrada.

**Qué no hace.** No aísla código: el host y los puertos inyectados son código confiable, no un sandbox, y el host es el monitor de referencia: sin su interposición no hay garantía. El host aporta el reloj y guarda los recibos. Los archivos tocados que se reportan se reportan, no se imponen. Un digest protege la integridad, no la identidad de quien aprobó. Un recibo dice qué se comprobó, no que el contenido entregado sea verdadero. Este corte no tiene ancla externa ni liquidación de pagos en vivo: el recorrido corre sin red y sin dinero. No ha tenido una auditoría de seguridad externa.

**Compruébalo tú mismo.** `node examples/walkthrough.js` muestra la puerta, la aprobación, la verificación separada y un recibo con su `notCovered`. Las pruebas adversariales son [`test/t1-adversarial.test.js`](../test/t1-adversarial.test.js) y [`test/skill-provenance-hardening.test.js`](../test/skill-provenance-hardening.test.js).
