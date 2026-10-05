# Testnet evidence

> Español: [más abajo](#evidencia-en-testnet)

These records let you compare what an operation declared with what its saved Horizon readback contains. All evidence is **Stellar testnet**, with fictional data and no real money. [testnet-evidence.json](./testnet-evidence.json) contains 50 readbacks, 5 cases semantically verified on operation, memo, asset, amount and recipient, 45 partially verified on only the facts their execution record declared, and 0 discrepancies. A successful transaction is not complete semantic verification; the expected facts come from local execution records, never from Horizon.

The saved list contains **50 successful transactions**, from 8 source accounts across ledgers 4987795 to 4996153, with transaction dates on 2026-10-02 and 2026-10-03. Capture timestamps are recorded in `summary.collected_at`, `summary.verified_at` and each `historical_response`; the responses are historical evidence, not a fresh network check. The transaction links below retain the earlier index, now read together with each case's `expectedFrom` and `verification`.

## Recheck the saved responses

From the repository root, first check shape and uniqueness without a network:

```sh
node scripts/verify-testnet-evidence.mjs --offline
```

That command does not compare transaction facts. To compare the stored responses against the recorded expectations, without network access or rewriting the evidence file, run:

```sh
node --input-type=module -e "import {readFileSync} from 'node:fs'; import {verifyEvidenceSet} from './scripts/verify-testnet-evidence.mjs'; const d=JSON.parse(readFileSync('docs/testnet-evidence.json','utf8')); const m=new Map(d.transactions.map(t=>[t.hash,t.historical_response])); const r=await verifyEvidenceSet(d.transactions,async h=>m.get(h)); const c={total:r.length,verified:r.filter(x=>x.ok===true).length,partial:r.filter(x=>x.field==='partial' && !x.discrepancies.length).length,mismatch:r.filter(x=>x.ok===false).length,discrepancy:r.filter(x=>x.discrepancies?.length).length,unread:r.filter(x=>!x.historical_response).length}; console.log(c); if(c.verified+c.partial!==c.total || c.mismatch || c.discrepancy || c.unread) process.exitCode=1;"
```

The result is `total: 50`, `verified: 5`, `partial: 45`, `mismatch: 0`, `discrepancy: 0`, `unread: 0`. This reproduces the comparison with saved data; it does not authenticate the transaction signatures or the execution records. [collect-testnet-evidence.mjs](../scripts/collect-testnet-evidence.mjs) derives expectations from records with file and line citations. Copies of the external execution records are in [evidence-records](./evidence-records/); check `expectedFrom` for their original repository and location.

For an optional fresh read of Horizon, run `node scripts/verify-testnet-evidence.mjs`. This reads the network without signing or submitting transactions, but writes fresh historical responses and verification results into `docs/testnet-evidence.json`; use a disposable checkout or a copy of that file if you want to retain the exact frozen evidence. A request error or unavailable transaction must not be treated as a successful recheck. Testnet records can disappear after a reset; saved responses are not proof of current availability.

## Field coverage and limits

The fully checked cases are the historical x402 adapter's payment runs and the operation-type probes. The partially checked cases cover TEMIS anchors and a historical idempotent payment. Anchors compare the locally declared digest memo, ledger, source account and success; concurrent records also compare the declared ledger, but the position inside that ledger remains unchecked. The idempotence record compares declared payment facts and the observed credit; it does not establish durable deduplication in the new kernel contract.

Line statuses, third-party reconstruction, lifecycle rules and contract events are not established by this comparison. `declared_but_unchecked` and `undeclared_facts` retain those omissions. Some x402 operation-type and absent-memo expectations are derived from this repository's historical adapter, with citations; they are not independent observations by the chain. The first payment's local receipt remains `not_verified` while its later readback matches the declared facts, so chain success does not rewrite that receipt's verdict. The [saved verified receipt](../demo/x402/receipts/live-testnet-2026-10-02.json) still lists `external anchor` as uncovered. This history is evidence for the earlier adapter only. It does not validate the deferred real-SDK reference integration, mainnet, an institution's adoption or integration of the new modules with Casa Firme or Vela.

**TEMIS: full agreement lifecycle, first run** (15)

<details>
<summary>Transactions</summary>

- ledger 4988781 · 2026-10-02T18:58:12Z · [`bd459ea5fea5…`](https://horizon-testnet.stellar.org/transactions/bd459ea5fea594db726f9ac3728807f3de29779a711f131a9819c32c85f1edd4)
- ledger 4988782 · 2026-10-02T18:58:17Z · [`655129682340…`](https://horizon-testnet.stellar.org/transactions/65512968234035225169cf4a920501f07005422cf84b60985fb89f4cd0827f58)
- ledger 4988783 · 2026-10-02T18:58:22Z · [`ea0231b92194…`](https://horizon-testnet.stellar.org/transactions/ea0231b92194350f698eb75355955a25ed3137ded5c7f992c21992d7d5d7ad0d)
- ledger 4988784 · 2026-10-02T18:58:27Z · [`95689cb5cea3…`](https://horizon-testnet.stellar.org/transactions/95689cb5cea3c3ae0c5a79f17cd57e028edd119eeea21b31c3e8461d887de167)
- ledger 4988785 · 2026-10-02T18:58:32Z · [`143979b1fde5…`](https://horizon-testnet.stellar.org/transactions/143979b1fde532875d93dc2f63e25d064eb4d549f5a4f2a63c6f1f75f68e9a40)
- ledger 4988786 · 2026-10-02T18:58:37Z · [`423974ba56ec…`](https://horizon-testnet.stellar.org/transactions/423974ba56ec29d3d5080679a8e86cf1c7948d67329da7436e7a042251123a73)
- ledger 4988787 · 2026-10-02T18:58:42Z · [`86c12eedb07b…`](https://horizon-testnet.stellar.org/transactions/86c12eedb07b7cb664d0542a3612fdc77c3da98016caab314e62feaf441b4c61)
- ledger 4988788 · 2026-10-02T18:58:47Z · [`51118d23a1c5…`](https://horizon-testnet.stellar.org/transactions/51118d23a1c5316cdeef4110a4634b056db7eb598ea1933c69c5a916215e1f6b)
- ledger 4988789 · 2026-10-02T18:58:52Z · [`56e4dbb3260e…`](https://horizon-testnet.stellar.org/transactions/56e4dbb3260e4915e6cb5bfd3442bfcc1255a9d81ec99449bfc911fecbd452e3)
- ledger 4988790 · 2026-10-02T18:58:57Z · [`165df06b95c8…`](https://horizon-testnet.stellar.org/transactions/165df06b95c879cae9de38978239b0575f5cd7b828464b668d5cc92d448979d8)
- ledger 4988791 · 2026-10-02T18:59:02Z · [`493a6f1cf06b…`](https://horizon-testnet.stellar.org/transactions/493a6f1cf06bdec8e5ecb62f979230fb3fc2663b99310e79b99211a5597b756a)
- ledger 4988792 · 2026-10-02T18:59:07Z · [`221b5bb7952c…`](https://horizon-testnet.stellar.org/transactions/221b5bb7952cb93b46f676f870f44c4e8ab267faf318860dc15838b1b11de7c1)
- ledger 4988793 · 2026-10-02T18:59:12Z · [`e93f8718064a…`](https://horizon-testnet.stellar.org/transactions/e93f8718064a8f6514c342378ed5af799a75b8429a1882cfb4f598b265555a46)
- ledger 4988794 · 2026-10-02T18:59:17Z · [`70d5c4bd4c65…`](https://horizon-testnet.stellar.org/transactions/70d5c4bd4c650a31239371ca610a262bbe95fbd0771502648b1cc7f07d296dd0)
- ledger 4988795 · 2026-10-02T18:59:22Z · [`12b84c7ede24…`](https://horizon-testnet.stellar.org/transactions/12b84c7ede24b753bb4b8e635d0daad92e23aff37d9c5658ccd0230b9270b835)

</details>

**TEMIS: full lifecycle, corrected run; lifecycle statuses are not checked by this comparison** (23)

<details>
<summary>Transactions</summary>

- ledger 4989043 · 2026-10-02T19:20:02Z · [`c4c3e3a0857b…`](https://horizon-testnet.stellar.org/transactions/c4c3e3a0857b85b57f9cd4f71c55951f998491f9e876f1148cbe9f352962f48e)
- ledger 4989044 · 2026-10-02T19:20:07Z · [`0a3fa813db9d…`](https://horizon-testnet.stellar.org/transactions/0a3fa813db9db5b3812dfd3616633c45cbc692cf7d061ea7a19b0c688595b232)
- ledger 4989045 · 2026-10-02T19:20:12Z · [`9901e04a88d3…`](https://horizon-testnet.stellar.org/transactions/9901e04a88d3792e3a7c53bf92d0eb590ab00d6213c6bcf46ba047e68de02aec)
- ledger 4989046 · 2026-10-02T19:20:17Z · [`436b3c757bfb…`](https://horizon-testnet.stellar.org/transactions/436b3c757bfbb86d0058d1ce4ec5a4d28b8968cf6a3076f3f5a8880c58f79c62)
- ledger 4989047 · 2026-10-02T19:20:22Z · [`a574a1ee6389…`](https://horizon-testnet.stellar.org/transactions/a574a1ee6389b6aaa6efecf18be584ef9ecea7deed64d42bb7ac4d925ce6d865)
- ledger 4989048 · 2026-10-02T19:20:27Z · [`8ec19d65a616…`](https://horizon-testnet.stellar.org/transactions/8ec19d65a616a1bc0f37ba02f5157ee913971363bdcbcb94921ffb4dec9b6f65)
- ledger 4989049 · 2026-10-02T19:20:32Z · [`65f8d09694a3…`](https://horizon-testnet.stellar.org/transactions/65f8d09694a32fe38d3bc77c9069058370efd363fa45b32b1028a11ff9d90fdb)
- ledger 4989050 · 2026-10-02T19:20:37Z · [`149072fbad72…`](https://horizon-testnet.stellar.org/transactions/149072fbad724c3ea82be313d750d60937f5c10728ad88fb05cb9ed6a909a7d7)
- ledger 4989051 · 2026-10-02T19:20:42Z · [`a53030f21bd6…`](https://horizon-testnet.stellar.org/transactions/a53030f21bd6682b69cab83c026ad1e7f49b6382917493552158d2b2c80da590)
- ledger 4989052 · 2026-10-02T19:20:47Z · [`9b44bd038cfb…`](https://horizon-testnet.stellar.org/transactions/9b44bd038cfbb7ce17fa4cc929f32d81b1e341cb8b935f78fbcc51577960a498)
- ledger 4989053 · 2026-10-02T19:20:52Z · [`d5ab4540688e…`](https://horizon-testnet.stellar.org/transactions/d5ab4540688ead20a3402cf0e4df83a471e0e2627e39af7e5cfc0e793ad645e3)
- ledger 4989054 · 2026-10-02T19:20:57Z · [`8899960a63f1…`](https://horizon-testnet.stellar.org/transactions/8899960a63f18ba369633fdc940af1aabac346fff1ea4e0f721b88f02c6cf1e1)
- ledger 4989055 · 2026-10-02T19:21:02Z · [`497e993973bc…`](https://horizon-testnet.stellar.org/transactions/497e993973bc25ba9050559121073f7db3a88290e8e39cab32fd988adaf7ce74)
- ledger 4989056 · 2026-10-02T19:21:07Z · [`6e5277d64a61…`](https://horizon-testnet.stellar.org/transactions/6e5277d64a6186ae46f07dc9893e289a1284a3321152fc20a400b4326d8fa17c)
- ledger 4989057 · 2026-10-02T19:21:12Z · [`9b8f5259c456…`](https://horizon-testnet.stellar.org/transactions/9b8f5259c456f0161e83971a23dc24cf6f27afd094ff1674a0471e312ef4d23e)
- ledger 4989058 · 2026-10-02T19:21:17Z · [`f214ae28eb07…`](https://horizon-testnet.stellar.org/transactions/f214ae28eb073936433480aeaeef345f6c7db626a5bde1ee6079b0b0947fb4ef)
- ledger 4989059 · 2026-10-02T19:21:22Z · [`34ee18dbdaba…`](https://horizon-testnet.stellar.org/transactions/34ee18dbdabaed895b37c7e830e4531f1cbafdfd282400033688c32c04e2be4a)
- ledger 4989060 · 2026-10-02T19:21:27Z · [`8ae6018de254…`](https://horizon-testnet.stellar.org/transactions/8ae6018de2544468902af713dd38baebccd90792aa7bcb001519c81fd4129323)
- ledger 4989061 · 2026-10-02T19:21:32Z · [`ee2e49487718…`](https://horizon-testnet.stellar.org/transactions/ee2e494877186f59388ffe38b719d79ce61a95cd5bb9c4f483ad5de1db76d04a)
- ledger 4989062 · 2026-10-02T19:21:37Z · [`4db430c5204a…`](https://horizon-testnet.stellar.org/transactions/4db430c5204abd5595f3ca316c8737c9d006268060790721a0d387ff893f6478)
- ledger 4989063 · 2026-10-02T19:21:42Z · [`5c6472c9d5d3…`](https://horizon-testnet.stellar.org/transactions/5c6472c9d5d3787ad00feadf31a503ba64b5cbbe1b1a9cbcef5065740005c3dd)
- ledger 4989064 · 2026-10-02T19:21:47Z · [`ba28ca142683…`](https://horizon-testnet.stellar.org/transactions/ba28ca1426835dd7d12a9b1c7628a834d7450f5b75e8dfcdd239c358652b7e47)
- ledger 4989065 · 2026-10-02T19:21:52Z · [`675cda89adba…`](https://horizon-testnet.stellar.org/transactions/675cda89adbab94bb89bbf737bb30c83d57f380c7850b7104ade9de06d5d0a78)

</details>

**TEMIS: muxed payTo and operation type probes** (2)

<details>
<summary>Transactions</summary>

- ledger 4995969 · 2026-10-03T04:57:12Z · [`a7b8393c5295…`](https://horizon-testnet.stellar.org/transactions/a7b8393c5295acfc445b857a026c016646f56ceb53193ece2ce09eebbf40830f)
- ledger 4995970 · 2026-10-03T04:57:17Z · [`44e0f7529500…`](https://horizon-testnet.stellar.org/transactions/44e0f75295004850dee7f6894d2111124d4c1a4d4e528bb777122878937a7542)

</details>

**TEMIS: idempotent x402 payment (one call, one real credit)** (1)

<details>
<summary>Transactions</summary>

- ledger 4996153 · 2026-10-03T05:12:32Z · [`5495a053cfde…`](https://horizon-testnet.stellar.org/transactions/5495a053cfde91f2ac2dd4eece581fc628072416cf9007d6ca78ab3becf4273a)

</details>

**TEMIS: concurrent anchors (two processes, three rounds)** (6)

<details>
<summary>Transactions</summary>

- ledger 4995994 · 2026-10-03T04:59:17Z · [`72c4e3db6e42…`](https://horizon-testnet.stellar.org/transactions/72c4e3db6e42ef352263d1a2a382d2343020d071ac7a981848d057d05fff18b2)
- ledger 4996000 · 2026-10-03T04:59:47Z · [`eaa79b261b4c…`](https://horizon-testnet.stellar.org/transactions/eaa79b261b4c8ef0dc4717a73fe72593d02c733e47afd121cfaa87e557fda451)
- ledger 4996005 · 2026-10-03T05:00:12Z · [`640699917583…`](https://horizon-testnet.stellar.org/transactions/64069991758381e8f9ca84b44ec10dfca022fdf05a69a9be714c77071396cb32)
- ledger 4996011 · 2026-10-03T05:00:42Z · [`725ec0a7645f…`](https://horizon-testnet.stellar.org/transactions/725ec0a7645f8cb525004b78001d9b9a6c882512588016b5232a834865efbcbf)
- ledger 4996016 · 2026-10-03T05:01:07Z · [`2a427fea35a1…`](https://horizon-testnet.stellar.org/transactions/2a427fea35a153ec7cec59907d885546c19b9bc60eca4357345e7393311ce357)
- ledger 4996022 · 2026-10-03T05:01:37Z · [`1e7bf39958f2…`](https://horizon-testnet.stellar.org/transactions/1e7bf39958f208824480ad2da12acb27bfbac59370427993e91fe6066b9c2bcd)

</details>

**Vespi: live x402 payment runs (the first came back not_verified because of our own bug, then verified)** (3)

<details>
<summary>Transactions</summary>

- ledger 4987795 · 2026-10-02T17:36:02Z · [`4748d366aafa…`](https://horizon-testnet.stellar.org/transactions/4748d366aafa23d9a65d3367238e43c610f97d5697c58fdc5958067651f64377)
- ledger 4987944 · 2026-10-02T17:48:27Z · [`e43e1ed80675…`](https://horizon-testnet.stellar.org/transactions/e43e1ed80675d2b7d174167765beeec1f6b5226b8bd2950fa8231e9bb31a9f91)
- ledger 4988161 · 2026-10-02T18:06:32Z · [`abb968e86d89…`](https://horizon-testnet.stellar.org/transactions/abb968e86d8997f6f555c4efe50dd5a70671dc5064b8220a7f2ea221de7650d5)

</details>

## What this does and does not show

The saved readbacks support the declared transaction facts under the field limits above; they do not establish receipt authenticity, private access, autonomous operation, mainnet support or production readiness. The [0.1.4 release note](./RELEASE_0.1.4_KERNEL.md) distinguishes the new kernel contracts from these historical runs. No new payment was sent to prepare this page.

---

# Evidencia en testnet

Estos registros permiten comparar lo que declaró una operación con su lectura guardada de Horizon. Toda evidencia corresponde a **Stellar testnet**, con datos ficticios y sin dinero real. [testnet-evidence.json](./testnet-evidence.json) contiene 50 lecturas, 5 casos verificados semánticamente en operación, memo, activo, monto y destinatario, 45 parcialmente verificados solo en los hechos que declaró su registro de ejecución, y 0 discrepancias. Una transacción exitosa no es verificación semántica completa; las expectativas vienen de registros locales de ejecución, nunca de Horizon.

La lista guardada contiene **50 transacciones exitosas**, desde 8 cuentas de origen entre los ledgers 4987795 y 4996153, con fechas de transacción del 2026-10-02 y 2026-10-03. Los tiempos de captura figuran en `summary.collected_at`, `summary.verified_at` y cada `historical_response`; son evidencia histórica y no una consulta nueva a la red. Los enlaces de abajo conservan el índice anterior, que ahora debes leer con `expectedFrom` y `verification` de cada caso.

## Comparar las respuestas guardadas

Desde la raíz del repositorio, comprueba primero forma y unicidad sin red:

```sh
node scripts/verify-testnet-evidence.mjs --offline
```

Ese comando no compara hechos. Para comparar las respuestas guardadas con las expectativas registradas, sin red ni reescribir el archivo, ejecuta:

```sh
node --input-type=module -e "import {readFileSync} from 'node:fs'; import {verifyEvidenceSet} from './scripts/verify-testnet-evidence.mjs'; const d=JSON.parse(readFileSync('docs/testnet-evidence.json','utf8')); const m=new Map(d.transactions.map(t=>[t.hash,t.historical_response])); const r=await verifyEvidenceSet(d.transactions,async h=>m.get(h)); const c={total:r.length,verified:r.filter(x=>x.ok===true).length,partial:r.filter(x=>x.field==='partial' && !x.discrepancies.length).length,mismatch:r.filter(x=>x.ok===false).length,discrepancy:r.filter(x=>x.discrepancies?.length).length,unread:r.filter(x=>!x.historical_response).length}; console.log(c); if(c.verified+c.partial!==c.total || c.mismatch || c.discrepancy || c.unread) process.exitCode=1;"
```

El resultado es `total: 50`, `verified: 5`, `partial: 45`, `mismatch: 0`, `discrepancy: 0`, `unread: 0`. Reproduce la comparación con datos guardados; no autentica firmas de transacciones ni registros de ejecución. [collect-testnet-evidence.mjs](../scripts/collect-testnet-evidence.mjs) deriva expectativas de registros con citas de archivo y línea. Las copias de registros externos están en [evidence-records](./evidence-records/); `expectedFrom` indica su repositorio y ubicación originales.

Si quieres una consulta nueva a Horizon, ejecuta `node scripts/verify-testnet-evidence.mjs`. Lee la red sin firmar ni enviar transacciones, pero escribe respuestas y resultados nuevos en `docs/testnet-evidence.json`; usa una copia descartable del repositorio o del archivo para conservar la evidencia exacta del corte. Un error de consulta o una transacción ausente no cuentan como comprobación exitosa. Los registros de testnet pueden desaparecer tras un reinicio; las respuestas guardadas no prueban disponibilidad actual.

## Cobertura por campos y límites

Los casos completos son corridas de pago del adaptador x402 histórico y pruebas de tipo de operación. Los parciales cubren anclas de TEMIS y un pago idempotente histórico. Las anclas comparan digest del memo declarado localmente, ledger, cuenta de origen y éxito; los registros concurrentes también comparan el ledger declarado, pero la posición dentro de ese ledger sigue sin comprobarse. El registro de idempotencia compara hechos del pago y el abono observado; no establece deduplicación durable del contrato nuevo del kernel.

Esta comparación no establece estatus de líneas, reconstrucción del tercero, reglas del ciclo de vida ni eventos de contrato. `declared_but_unchecked` y `undeclared_facts` conservan las omisiones. Algunas expectativas de tipo de operación y memo ausente en x402 se derivan del adaptador histórico de este repositorio, con citas; no son observaciones independientes de la cadena. El primer recibo local sigue en `not_verified` aunque su lectura posterior coincida con los hechos declarados: el éxito de cadena no reescribe ese veredicto. [El recibo verificado guardado](../demo/x402/receipts/live-testnet-2026-10-02.json) todavía deja `external anchor` fuera de cobertura. Esta historia es evidencia del adaptador anterior. No valida la integración de referencia diferida con el SDK real, mainnet, adopción institucional ni integración de los módulos nuevos con Casa Firme o Vela.

**TEMIS: ciclo completo de un acuerdo, primera corrida** (15)

<details>
<summary>Transacciones</summary>

- ledger 4988781 · 2026-10-02T18:58:12Z · [`bd459ea5fea5…`](https://horizon-testnet.stellar.org/transactions/bd459ea5fea594db726f9ac3728807f3de29779a711f131a9819c32c85f1edd4)
- ledger 4988782 · 2026-10-02T18:58:17Z · [`655129682340…`](https://horizon-testnet.stellar.org/transactions/65512968234035225169cf4a920501f07005422cf84b60985fb89f4cd0827f58)
- ledger 4988783 · 2026-10-02T18:58:22Z · [`ea0231b92194…`](https://horizon-testnet.stellar.org/transactions/ea0231b92194350f698eb75355955a25ed3137ded5c7f992c21992d7d5d7ad0d)
- ledger 4988784 · 2026-10-02T18:58:27Z · [`95689cb5cea3…`](https://horizon-testnet.stellar.org/transactions/95689cb5cea3c3ae0c5a79f17cd57e028edd119eeea21b31c3e8461d887de167)
- ledger 4988785 · 2026-10-02T18:58:32Z · [`143979b1fde5…`](https://horizon-testnet.stellar.org/transactions/143979b1fde532875d93dc2f63e25d064eb4d549f5a4f2a63c6f1f75f68e9a40)
- ledger 4988786 · 2026-10-02T18:58:37Z · [`423974ba56ec…`](https://horizon-testnet.stellar.org/transactions/423974ba56ec29d3d5080679a8e86cf1c7948d67329da7436e7a042251123a73)
- ledger 4988787 · 2026-10-02T18:58:42Z · [`86c12eedb07b…`](https://horizon-testnet.stellar.org/transactions/86c12eedb07b7cb664d0542a3612fdc77c3da98016caab314e62feaf441b4c61)
- ledger 4988788 · 2026-10-02T18:58:47Z · [`51118d23a1c5…`](https://horizon-testnet.stellar.org/transactions/51118d23a1c5316cdeef4110a4634b056db7eb598ea1933c69c5a916215e1f6b)
- ledger 4988789 · 2026-10-02T18:58:52Z · [`56e4dbb3260e…`](https://horizon-testnet.stellar.org/transactions/56e4dbb3260e4915e6cb5bfd3442bfcc1255a9d81ec99449bfc911fecbd452e3)
- ledger 4988790 · 2026-10-02T18:58:57Z · [`165df06b95c8…`](https://horizon-testnet.stellar.org/transactions/165df06b95c879cae9de38978239b0575f5cd7b828464b668d5cc92d448979d8)
- ledger 4988791 · 2026-10-02T18:59:02Z · [`493a6f1cf06b…`](https://horizon-testnet.stellar.org/transactions/493a6f1cf06bdec8e5ecb62f979230fb3fc2663b99310e79b99211a5597b756a)
- ledger 4988792 · 2026-10-02T18:59:07Z · [`221b5bb7952c…`](https://horizon-testnet.stellar.org/transactions/221b5bb7952cb93b46f676f870f44c4e8ab267faf318860dc15838b1b11de7c1)
- ledger 4988793 · 2026-10-02T18:59:12Z · [`e93f8718064a…`](https://horizon-testnet.stellar.org/transactions/e93f8718064a8f6514c342378ed5af799a75b8429a1882cfb4f598b265555a46)
- ledger 4988794 · 2026-10-02T18:59:17Z · [`70d5c4bd4c65…`](https://horizon-testnet.stellar.org/transactions/70d5c4bd4c650a31239371ca610a262bbe95fbd0771502648b1cc7f07d296dd0)
- ledger 4988795 · 2026-10-02T18:59:22Z · [`12b84c7ede24…`](https://horizon-testnet.stellar.org/transactions/12b84c7ede24b753bb4b8e635d0daad92e23aff37d9c5658ccd0230b9270b835)

</details>

**TEMIS: ciclo completo, corrida corregida; esta comparación no verifica estatus del ciclo de vida** (23)

<details>
<summary>Transacciones</summary>

- ledger 4989043 · 2026-10-02T19:20:02Z · [`c4c3e3a0857b…`](https://horizon-testnet.stellar.org/transactions/c4c3e3a0857b85b57f9cd4f71c55951f998491f9e876f1148cbe9f352962f48e)
- ledger 4989044 · 2026-10-02T19:20:07Z · [`0a3fa813db9d…`](https://horizon-testnet.stellar.org/transactions/0a3fa813db9db5b3812dfd3616633c45cbc692cf7d061ea7a19b0c688595b232)
- ledger 4989045 · 2026-10-02T19:20:12Z · [`9901e04a88d3…`](https://horizon-testnet.stellar.org/transactions/9901e04a88d3792e3a7c53bf92d0eb590ab00d6213c6bcf46ba047e68de02aec)
- ledger 4989046 · 2026-10-02T19:20:17Z · [`436b3c757bfb…`](https://horizon-testnet.stellar.org/transactions/436b3c757bfbb86d0058d1ce4ec5a4d28b8968cf6a3076f3f5a8880c58f79c62)
- ledger 4989047 · 2026-10-02T19:20:22Z · [`a574a1ee6389…`](https://horizon-testnet.stellar.org/transactions/a574a1ee6389b6aaa6efecf18be584ef9ecea7deed64d42bb7ac4d925ce6d865)
- ledger 4989048 · 2026-10-02T19:20:27Z · [`8ec19d65a616…`](https://horizon-testnet.stellar.org/transactions/8ec19d65a616a1bc0f37ba02f5157ee913971363bdcbcb94921ffb4dec9b6f65)
- ledger 4989049 · 2026-10-02T19:20:32Z · [`65f8d09694a3…`](https://horizon-testnet.stellar.org/transactions/65f8d09694a32fe38d3bc77c9069058370efd363fa45b32b1028a11ff9d90fdb)
- ledger 4989050 · 2026-10-02T19:20:37Z · [`149072fbad72…`](https://horizon-testnet.stellar.org/transactions/149072fbad724c3ea82be313d750d60937f5c10728ad88fb05cb9ed6a909a7d7)
- ledger 4989051 · 2026-10-02T19:20:42Z · [`a53030f21bd6…`](https://horizon-testnet.stellar.org/transactions/a53030f21bd6682b69cab83c026ad1e7f49b6382917493552158d2b2c80da590)
- ledger 4989052 · 2026-10-02T19:20:47Z · [`9b44bd038cfb…`](https://horizon-testnet.stellar.org/transactions/9b44bd038cfbb7ce17fa4cc929f32d81b1e341cb8b935f78fbcc51577960a498)
- ledger 4989053 · 2026-10-02T19:20:52Z · [`d5ab4540688e…`](https://horizon-testnet.stellar.org/transactions/d5ab4540688ead20a3402cf0e4df83a471e0e2627e39af7e5cfc0e793ad645e3)
- ledger 4989054 · 2026-10-02T19:20:57Z · [`8899960a63f1…`](https://horizon-testnet.stellar.org/transactions/8899960a63f18ba369633fdc940af1aabac346fff1ea4e0f721b88f02c6cf1e1)
- ledger 4989055 · 2026-10-02T19:21:02Z · [`497e993973bc…`](https://horizon-testnet.stellar.org/transactions/497e993973bc25ba9050559121073f7db3a88290e8e39cab32fd988adaf7ce74)
- ledger 4989056 · 2026-10-02T19:21:07Z · [`6e5277d64a61…`](https://horizon-testnet.stellar.org/transactions/6e5277d64a6186ae46f07dc9893e289a1284a3321152fc20a400b4326d8fa17c)
- ledger 4989057 · 2026-10-02T19:21:12Z · [`9b8f5259c456…`](https://horizon-testnet.stellar.org/transactions/9b8f5259c456f0161e83971a23dc24cf6f27afd094ff1674a0471e312ef4d23e)
- ledger 4989058 · 2026-10-02T19:21:17Z · [`f214ae28eb07…`](https://horizon-testnet.stellar.org/transactions/f214ae28eb073936433480aeaeef345f6c7db626a5bde1ee6079b0b0947fb4ef)
- ledger 4989059 · 2026-10-02T19:21:22Z · [`34ee18dbdaba…`](https://horizon-testnet.stellar.org/transactions/34ee18dbdabaed895b37c7e830e4531f1cbafdfd282400033688c32c04e2be4a)
- ledger 4989060 · 2026-10-02T19:21:27Z · [`8ae6018de254…`](https://horizon-testnet.stellar.org/transactions/8ae6018de2544468902af713dd38baebccd90792aa7bcb001519c81fd4129323)
- ledger 4989061 · 2026-10-02T19:21:32Z · [`ee2e49487718…`](https://horizon-testnet.stellar.org/transactions/ee2e494877186f59388ffe38b719d79ce61a95cd5bb9c4f483ad5de1db76d04a)
- ledger 4989062 · 2026-10-02T19:21:37Z · [`4db430c5204a…`](https://horizon-testnet.stellar.org/transactions/4db430c5204abd5595f3ca316c8737c9d006268060790721a0d387ff893f6478)
- ledger 4989063 · 2026-10-02T19:21:42Z · [`5c6472c9d5d3…`](https://horizon-testnet.stellar.org/transactions/5c6472c9d5d3787ad00feadf31a503ba64b5cbbe1b1a9cbcef5065740005c3dd)
- ledger 4989064 · 2026-10-02T19:21:47Z · [`ba28ca142683…`](https://horizon-testnet.stellar.org/transactions/ba28ca1426835dd7d12a9b1c7628a834d7450f5b75e8dfcdd239c358652b7e47)
- ledger 4989065 · 2026-10-02T19:21:52Z · [`675cda89adba…`](https://horizon-testnet.stellar.org/transactions/675cda89adbab94bb89bbf737bb30c83d57f380c7850b7104ade9de06d5d0a78)

</details>

**TEMIS: pruebas de payTo multiplexada y de tipo de operación** (2)

<details>
<summary>Transacciones</summary>

- ledger 4995969 · 2026-10-03T04:57:12Z · [`a7b8393c5295…`](https://horizon-testnet.stellar.org/transactions/a7b8393c5295acfc445b857a026c016646f56ceb53193ece2ce09eebbf40830f)
- ledger 4995970 · 2026-10-03T04:57:17Z · [`44e0f7529500…`](https://horizon-testnet.stellar.org/transactions/44e0f75295004850dee7f6894d2111124d4c1a4d4e528bb777122878937a7542)

</details>

**TEMIS: pago x402 idempotente (una llamada, un abono real)** (1)

<details>
<summary>Transacciones</summary>

- ledger 4996153 · 2026-10-03T05:12:32Z · [`5495a053cfde…`](https://horizon-testnet.stellar.org/transactions/5495a053cfde91f2ac2dd4eece581fc628072416cf9007d6ca78ab3becf4273a)

</details>

**TEMIS: anclajes concurrentes (dos procesos, tres rondas)** (6)

<details>
<summary>Transacciones</summary>

- ledger 4995994 · 2026-10-03T04:59:17Z · [`72c4e3db6e42…`](https://horizon-testnet.stellar.org/transactions/72c4e3db6e42ef352263d1a2a382d2343020d071ac7a981848d057d05fff18b2)
- ledger 4996000 · 2026-10-03T04:59:47Z · [`eaa79b261b4c…`](https://horizon-testnet.stellar.org/transactions/eaa79b261b4c8ef0dc4717a73fe72593d02c733e47afd121cfaa87e557fda451)
- ledger 4996005 · 2026-10-03T05:00:12Z · [`640699917583…`](https://horizon-testnet.stellar.org/transactions/64069991758381e8f9ca84b44ec10dfca022fdf05a69a9be714c77071396cb32)
- ledger 4996011 · 2026-10-03T05:00:42Z · [`725ec0a7645f…`](https://horizon-testnet.stellar.org/transactions/725ec0a7645f8cb525004b78001d9b9a6c882512588016b5232a834865efbcbf)
- ledger 4996016 · 2026-10-03T05:01:07Z · [`2a427fea35a1…`](https://horizon-testnet.stellar.org/transactions/2a427fea35a153ec7cec59907d885546c19b9bc60eca4357345e7393311ce357)
- ledger 4996022 · 2026-10-03T05:01:37Z · [`1e7bf39958f2…`](https://horizon-testnet.stellar.org/transactions/1e7bf39958f208824480ad2da12acb27bfbac59370427993e91fe6066b9c2bcd)

</details>

**Vespi: corridas de pago x402 en vivo (la primera salió no_verificado por un error nuestro, luego verificado)** (3)

<details>
<summary>Transacciones</summary>

- ledger 4987795 · 2026-10-02T17:36:02Z · [`4748d366aafa…`](https://horizon-testnet.stellar.org/transactions/4748d366aafa23d9a65d3367238e43c610f97d5697c58fdc5958067651f64377)
- ledger 4987944 · 2026-10-02T17:48:27Z · [`e43e1ed80675…`](https://horizon-testnet.stellar.org/transactions/e43e1ed80675d2b7d174167765beeec1f6b5226b8bd2950fa8231e9bb31a9f91)
- ledger 4988161 · 2026-10-02T18:06:32Z · [`abb968e86d89…`](https://horizon-testnet.stellar.org/transactions/abb968e86d8997f6f555c4efe50dd5a70671dc5064b8220a7f2ea221de7650d5)

</details>

## Qué muestra y qué no

Las lecturas guardadas sostienen los hechos declarados bajo los límites por campo anteriores; no establecen autenticidad de recibos, acceso privado, operación autónoma, soporte mainnet ni preparación para producción. [La nota del 0.1.4](./RELEASE_0.1.4_KERNEL.md) separa los contratos nuevos del kernel de estas corridas históricas. No se envió un pago nuevo para preparar esta página.
