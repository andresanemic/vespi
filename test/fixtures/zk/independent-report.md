Entregados `vectores.json`, `manifiesto.json` y los scripts. La verificación offline pasó: **165 unidades de vector comprobadas; 8 pruebas aprobadas, 0 fallidas y 0 omitidas**. Oráculo: `py_ecc 8.0.0` (MIT, Ethereum Foundation), CPython `3.14.5`. Fecha: 2026-10-04. Trabajo completado dentro del presupuesto de 60 minutos.

Archivos creados y propósito:

- `vectores.json`: datos numéricos como cadenas decimales, con puntos, resultados, motivos de rechazo y convenciones.
- `manifiesto.json`: versiones, fecha UTC, procedencia, dependencias, comando de generación y SHA-256 de vectores, scripts y rojo inicial.
- `generar_vectores.py`: genera los datos con `py_ecc`, con aserciones antes de escribirlos. No contiene código copiado de la biblioteca.
- `test_vectors.py`: comprobador separado que carga el JSON, recalcula resultados y comprueba formato, propiedades algebraicas y hashes. No importa el generador. Revisa aritmética también mediante la implementación afín de `py_ecc`; los productos se recalculan con una sola exponenciación final del producto de Miller, frente a pairings completos individuales en la generación.
- `rojo.txt`: primera corrida, anterior al generador, 8 errores por ausencia del JSON. Es un rojo de contrato de artefactos, no una falla observada en el kernel.
- `verificacion-intermedia.txt`: conserva la corrida con 165 vectores correctos y 1 error del comprobador al sumar una constante `int` a `FQ12`. Se corrigió usando constantes `FQ12`.
- `verde.txt`: corrida final completa, exit 0, 8 aprobadas, 0 fallidas, 0 omitidas; 165 comprobaciones de vector pasaron.
- `generacion.txt`: salida de la generación con sus aserciones y digest.
- `requirements.txt`: versiones fijadas por `pip freeze`; `.venv/`: instalación local del oráculo y sus dependencias.
- `informe.md`: este informe. `../k3c-vectores.progress`: hitos con hora; única escritura fuera del directorio, autorizada por el encargo.

Comandos de preparación y comprobación ejecutados desde este directorio, con su resultado:

- `python --version`: Python 3.14.5, exit 0.
- `python -m venv .venv`: entorno creado, exit 0.
- `./.venv/Scripts/python.exe -m pip install py_ecc`: instalado py_ecc 8.0.0 y sus dependencias en el entorno, exit 0. Única operación de red solicitada, mediante pip.
- `./.venv/Scripts/python.exe test_vectors.py *> rojo.txt`: exit 1; 8 errores por archivo ausente, 0 vectores comprobados. Se escribió primero el comprobador y solo después de guardar este rojo se escribió el generador.
- `./.venv/Scripts/python.exe generar_vectores.py *> generacion.txt`: tres ejecuciones, todas exit 0. Mismo SHA-256 de `vectores.json` en las tres; se regeneró el manifiesto tras ampliar y corregir el comprobador.
- `./.venv/Scripts/python.exe test_vectors.py *> verde.txt`: primera ejecución posterior al generador, exit 1 por el error de tipo documentado; ejecución final, exit 0, 8 aprobadas, 0 fallidas, 0 omitidas, 165 vectores comprobados.
- `Copy-Item -LiteralPath verde.txt -Destination verificacion-intermedia.txt`: conservó la corrida intermedia antes de reemplazar la salida final, exit 0.
- `./.venv/Scripts/python.exe -m pip freeze > requirements.txt`: versiones guardadas, exit 0.
- `Get-FileHash -LiteralPath vectores.json -Algorithm SHA256`: coincidió con el manifiesto, exit 0.
- `git rev-parse --show-toplevel` y `git status --short`: exit 128, directorio sin repositorio. Se repitió `git status --short` al cerrar, con el mismo resultado. No hubo commits ni cambios en repositorios.

Se leyeron mediante `Get-Content -LiteralPath` las decisiones 16, 19, 22, 24, 27 y 31, el acuerdo, identidad, principios, arquitectura y registro indicados. `Get-ChildItem -Force` confirmó que el espacio estaba vacío. Los archivos del kernel y su suite no están aquí: **`node --test test/*.test.js` no se ejecutó**. Las 277 aprobadas de referencia no se verificaron en esta tarea; tampoco se verificaron exports ni digests de recibos. No se modificaron README, CHANGELOG ni notas de versión. La instrucción específica de K3c de no escribir en repositorios prevaleció sobre la regla común de hacer commits.

Cobertura de los 165 elementos: 1 conjunto de constantes; 65 operaciones G1 (15 sumas y 10 de cada tipo: doble, multiplicación, negación, suma con infinito, suma con negado); 60 operaciones G2 (10 de cada tipo); 16 puntos inválidos; 6 pairings completos; 12 productos; 4 casos de la ecuación Groth16 sintética y 1 referencia válida adicional con otra VK. Ambos grupos incluyen escalares 0, 1, r-1, r y r+1, y otros escalares grandes. Los seis pairings incluyen infinito en G1 y en G2.

Casos adversariales: G1 contiene 4 coordenadas no canónicas y 4 puntos fuera de curva. G2 contiene 2 coordenadas no canónicas, 2 puntos fuera del twist y **4 puntos canónicos en el twist fuera del subgrupo**, con `[r]P` no infinito recalculado y entregado. Seis productos de pairings fallan al alterar el exponente en una unidad. El caso sintético falla con señal alterada, A alterado y VK de otra prueba sintética; esa segunda VK tiene además su propia prueba sintética válida comprobada. El comprobador rechaza formatos numéricos ambiguos, longitudes Fp2/Fp12 incorrectas, coeficientes no canónicos, aridad incorrecta y señal igual a r; confirma que intercambiar c0 y c1 del generador G2 rompe la ecuación del twist. Estos rechazos son comprobaciones del paquete de vectores, no una ejecución del verificador JavaScript.

Las constantes p y r coinciden exactamente con los hexadecimales dados. El parámetro BN `u=4965661367192848881` se deriva del `ate_loop_count` expuesto por py_ecc, pues esa versión no expone u con nombre propio; se verificó con los polinomios de p y r. Se incluyen b, b2 y generadores según la biblioteca.

SHA-256 de `vectores.json`:

`e94d5ba03570851c5cb71f86070d8dccc2eea74cdd4fce6e9c0a2a0adbacdd42`

Límites y riesgos abiertos: circuito Groth16 real, **no producido**. La opción ligera solicitada se entrega como ecuación sintética, con todos sus escalares divulgados; no hay circuito, witness, QAP, ceremonia ni prueba de seguridad. Tampoco se comprobaron el vector Stellar, la integración JavaScript, parsers del kernel, resistencia a canales laterales, rendimiento, DoS ni cobertura exhaustiva. La independencia es respecto del motor JavaScript bajo prueba, no una auditoría independiente de py_ecc; sus dos rutas de aritmética pertenecen a la misma biblioteca. El consumidor debe verificar sus propios rechazos y adaptar explícitamente la representación Fp12 y la convención de pairing antes de comparar. Los datos de construcción son públicos y no son claves de uso operativo. No se leyeron ni escribieron secretos.

Párrafo listo para documentación en inglés:

Independent BN254 fixtures generated with py_ecc 8.0.0 cover curve constants, G1/G2 arithmetic, noncanonical and off-curve inputs, four on-twist G2 points outside the order-r subgroup, full pairings, and passing and failing pairing products. All 165 fixture units were checked offline. The Groth16 example is a synthetic pairing equation with disclosed construction scalars, not a real circuit or a security proof. These fixtures do not establish correctness of the JavaScript verifier until that implementation consumes and passes them.

Párrafo listo para documentación en español:

Los vectores independientes BN254 generados con py_ecc 8.0.0 cubren constantes, aritmética G1/G2, coordenadas no canónicas, puntos fuera de curva, cuatro puntos G2 en el twist fuera del subgrupo de orden r, pairings completos y productos válidos e inválidos. Se comprobaron offline las 165 unidades de vector. El ejemplo Groth16 es una ecuación sintética con sus escalares divulgados, no un circuito real ni una prueba de seguridad. Estos datos no acreditan la corrección del verificador JavaScript hasta que esa implementación los consuma y pase.

Instrucciones de uso: carga el archivo con `JSON.parse(readFileSync('vectores.json', 'utf8'))` en JavaScript, importando `readFileSync` desde `node:fs`. Convierte las cadenas numéricas con `BigInt`, nunca con `Number`. G1 es `{x,y}`, G2 es `{x:[c0,c1],y:[c0,c1]}` y el infinito es `null`. Fp2 representa `c0+c1*i`, con `i²=-1`. Fp12 usa `[c0,...,c11]` en la base polinómica `sum(cj*w^j)`, con `w^12-18*w^6+82=0` e `i=w^6-9`; no es una lista de coeficientes de una torre Fp2/Fp6 sin conversión. La unidad es `["1","0",...,"0"]`. `e(P,Q)` corresponde a `py_ecc.pairing(Q,P,final_exponentiate=True)`, incluido el orden invertido de argumentos de su API. Comprueba las coordenadas crudas antes de reducirlas módulo p; comprueba curva y subgrupo G2. Los escalares de multiplicación pueden exceder r; las señales públicas de estos casos deben ser menores que r. Compara puntos canónicos y los doce coeficientes exactamente, tras una conversión de base documentada si corresponde: **tolerancias, ninguna**. Para repetir la verificación usa `./.venv/Scripts/python.exe test_vectors.py`; no necesita red.
