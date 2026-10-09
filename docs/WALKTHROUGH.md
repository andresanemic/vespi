# Walkthrough: one operation, end to end

This dependency-free example runs offline on Node.js 24 or later. It exercises the kernel in this order: insufficient permission opens the human gate; the human approves; the capability performs one local effect; a separate verifier observes it; the kernel returns a receipt with its coverage; then a second Node process resumes the next approved action from that receipt.

The person approves by typing `Name: approve` at the terminal. The name is attribution supplied by the operator, not a UI or proof of civil identity. The separate host verifier is a local fixture that inspects the ledger after the capability writes it. Nothing calls a network or uses an external clock as part of the example's decisions. The kernel currently creates runtime operation IDs and receipt timestamps internally; the transcript omits those fields, while the receipt digest therefore changes between runs.

Run from the repository root:

```text
> node examples/walkthrough.js
gate: needs_human_decision (insufficient permission; no effect ran)
human approval [Name: approve]: Operator: approve
approval: approved by Operator
effect: ledger note written
observation: note present (separate verifier)
receipt: {"status":"verified","digest":"22a4163086d8d35861a6aa4ff0025ced02b92b4156135896020d25f6e8ca7027","coverage":["effect_present","recipient_matches"],"notCovered":["network_anchor","external anchor"]}
second process: resumes next action publish_summary
```

The output above is from a real run of the checked-in example. The digest is a snapshot; a later run gets a different digest because runtime fields are sealed into the receipt. `coverage` names the two checks that returned true. `network_anchor` failed and `external anchor` was outside this local example, so both remain in `notCovered`. The receipt proves its contents match its digest; it does not authenticate the operator or prove an external anchor.

The second process receives the serialized receipt over standard input, verifies it through `resumeFromReceipts`, and selects `publish_summary` as the next action. The example injects a local verification callback to model the host's independent observation. It does not persist state between processes, publish a summary or claim that a local receipt alone authenticates an external effect.

The automated test runs this whole parent-and-child-process path:

```text
> node --test test/walkthrough.test.js
```

---

# Recorrido: una operación completa

Este ejemplo no tiene dependencias y corre sin internet con Node.js 24 o posterior. Recorre el kernel en este orden: un permiso insuficiente abre la puerta humana; la persona aprueba; la capacidad ejecuta un efecto local; un verificador separado lo observa; el kernel devuelve un recibo con su cobertura; después, un segundo proceso de Node retoma la siguiente acción aprobada desde ese recibo.

La persona aprueba escribiendo `Nombre: approve` en la terminal. El nombre es una atribución que entrega quien opera, no una interfaz ni una prueba de identidad civil. El verificador separado del host es un fixture local que inspecciona el registro después de que la capacidad escribe. Nada llama a una red ni usa un reloj externo para decidir el recorrido. El kernel crea internamente los IDs de operación y las marcas de tiempo; la transcripción omite esos campos, por lo que el digest cambia entre ejecuciones.

Corre desde la raíz del repositorio:

```text
> node examples/walkthrough.js
gate: needs_human_decision (insufficient permission; no effect ran)
human approval [Name: approve]: Operator: approve
approval: approved by Operator
effect: ledger note written
observation: note present (separate verifier)
receipt: {"status":"verified","digest":"22a4163086d8d35861a6aa4ff0025ced02b92b4156135896020d25f6e8ca7027","coverage":["effect_present","recipient_matches"],"notCovered":["network_anchor","external anchor"]}
second process: resumes next action publish_summary
```



La salida anterior viene de una ejecución real del ejemplo incluido. `coverage` nombra los dos chequeos que devolvieron verdadero. `network_anchor` falló y `external anchor` queda fuera de este ejemplo local, por eso ambos siguen en `notCovered`. El recibo prueba que su contenido coincide con su digest; no autentica a quien aprobó ni demuestra un anclaje externo.

El segundo proceso recibe el recibo serializado por la entrada estándar, lo verifica con `resumeFromReceipts` y selecciona `publish_summary` como siguiente acción. El ejemplo inyecta una función de verificación local para representar la observación independiente del host. No persiste estado entre procesos, no publica un resumen ni afirma que un recibo local por sí solo autentique un efecto externo.

La prueba automatizada recorre todo el camino de proceso padre e hijo:

```text
> node --test test/walkthrough.test.js
```


