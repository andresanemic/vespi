// Hechos del corte, en un solo lugar. Ninguna version ni enlace de prueba se escribe a mano
// en un componente: todo sale de aqui. Founder revalida este archivo antes de cada publicacion.
//
// Frontera entre lo grabado y lo publicado: la demostracion que se abre en el sitio es la corrida
// grabada del kernel 0.1.6 (tag `v0.1.6-kernel`, commit y digest abajo, ver arbitraje/); la version
// publicada hoy es el kernel 0.1.8 (tag `v0.1.8-kernel`) con el kit Lore Plugin 2.5.3.
export const CORTE = {
  published: { kernel: '0.1.8', kit: '2.5.3' },
  // Tag del corte grabado: de aqui salen los enlaces de prueba y la corrida de abajo, que es la
  // que se puede auditar. No confundirlo con `published.kernel`, que es lo que se publica hoy.
  kernelTag: 'v0.1.6-kernel',
  // Corrida grabada de `node examples/walkthrough.js` desde el tag de arriba.
  run: {
    commit: '39d4573',
    node: '24.15',
    date: '2026-10-11',
    digest: '7bcdcb2e4754fca31b616155383f63edf8b7c3c3cc9881afb9affe51ee8a6a5a',
  },
  // Decision de Andres (2026-10-10): el codigo de los once proyectos se publica en sus repos hoy y
  // queda abierto a revision del 12 al 16 de octubre, bajo licencia de solo revision.
  projectsCodeOpen: true,
  // Caso de app principal. Se elige el 12 por evidencia verificable; null hasta entonces.
  featuredCase: null as null | { name: string; url: string },
} as const;

export const REPO = 'https://github.com/andresanemic/vespi';
export const KIT_REPO = 'https://github.com/andresanemic/lore-plugin';
const at = (path: string, tag: string = CORTE.kernelTag) => `${REPO}/blob/${tag}/${path}`;
const publishedTag = `v${CORTE.published.kernel}-kernel`;

// Enlaces de prueba abribles. Todos resuelven (HTTP 200) en el tag publicado.
// Una sola frase sobre el codigo de los once proyectos, en los dos idiomas. Cambia con la bandera.
export const CODE_LINE = {
  en: CORTE.projectsCodeOpen
    ? 'The eleven projects have public code you can run, under a review-only license.'
    : 'The eleven projects are documented today; their code opens on 12-16 October 2026.',
  es: CORTE.projectsCodeOpen
    ? 'Los once proyectos tienen el código público para que lo corras, con licencia de solo revisión.'
    : 'Los once proyectos están documentados hoy; su código se abre entre el 12 y el 16 de octubre de 2026.',
} as const;

// La linea corta bajo el llamado de la primera pantalla: lo que funciona hoy, sin adornos.
export const TODAY_LINE = {
  en: CORTE.projectsCodeOpen
    ? 'TODAY: ONE OPERATION YOU CAN RUN OFFLINE AND 11 PROJECTS WITH PUBLIC CODE.'
    : 'TODAY: ONE OPERATION YOU CAN RUN OFFLINE. THE 11 PROJECTS: DOCUMENTED, CODE ON 12-16 OCT.',
  es: CORTE.projectsCodeOpen
    ? 'HOY: UNA OPERACIÓN SIN CONEXIÓN Y 11 PROYECTOS CON CÓDIGO PÚBLICO.'
    : 'HOY: UNA OPERACIÓN QUE PUEDES CORRER SIN CONEXIÓN. LOS 11 PROYECTOS: DOCUMENTADOS, CÓDIGO EL 12-16 DE OCT.',
} as const;

export const PROOF = {
  walkthroughScript: at('examples/walkthrough.js', publishedTag),
  walkthroughDoc: at('docs/WALKTHROUGH.md', publishedTag),
  capabilities: at('docs/CAPABILITIES.md', publishedTag),
  testnetEvidence: at('docs/TESTNET_EVIDENCE.md'),
  judges: `${REPO}/blob/master/docs/FOR_JUDGES.md`,
  judge3: `${REPO}/blob/master/docs/JUDGE_IN_3_MINUTES.md`,
  whyStellar: at('docs/WHY_STELLAR.md', publishedTag),
  threatModel: at('docs/THREAT_MODEL.md', publishedTag),
  x402: at('demo/x402/README.md', publishedTag),
  release: at('docs/RELEASE_0.1.8_KERNEL.md', publishedTag),
  historicPaymentReceipt: at('demo/x402/receipts/live-testnet-2026-10-02.json'),
  historicPaymentTx: 'https://horizon-testnet.stellar.org/transactions/abb968e86d8997f6f555c4efe50dd5a70671dc5064b8220a7f2ea221de7650d5',
  kitInstall: `${KIT_REPO}#installation`,
  // Vespi Contributions: la prueba que existe hoy (sandbox en testnet, roles simulados) y el
  // anclaje historico en mainnet, que no es el piloto. Reproducido el 2026-11-10 en el commit
  // 9624922 con Node 24: 9 pruebas pasan y el verificador devuelve VERIFIED sin red.
  sandbox: `${REPO}/tree/master/demo/sandbox`,
  mainnetAnchor: 'https://stellar.expert/explorer/public/tx/2ff744c69fc01c0de2016e45c5f157b0434382572f2dfc997e8e1d4e34af09d7',
} as const;

// Video de Vespi Contributions V4.2 (98,9 s, voz en inglés, subtítulos EN y ES en YouTube),
// publicado por Andrés el 2026-11-10.
export const CONTRIBUTIONS_VIDEO = {
  id: 'eRV_evhc2u0',
  url: 'https://www.youtube.com/watch?v=eRV_evhc2u0',
} as const;

// Pitch deck de Vespi Contributions V4.2 (10 láminas, PDF), subido por Andrés a Drive el
// 2026-11-10.
export const CONTRIBUTIONS_DECK = {
  en: 'https://drive.google.com/file/d/1be8oVS8xLg_wuCsyw27IEkkf89GEC0Kq/view?usp=sharing',
  es: 'https://drive.google.com/file/d/12jYOwr-SK69FeBXlCzHLaz6y2wQDKpyx/view?usp=sharing',
} as const;
