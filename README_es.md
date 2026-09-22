<!-- Imagen hero pendiente: este espacio se mantiene vacío hasta aprobar el tablero visual. -->

<h1 align="center">Vespi</h1>

<p align="center">
  <a href="#estado"><img src="https://img.shields.io/badge/versi%C3%B3n-v0.0.1--genesis-FF7C6B?style=for-the-badge&labelColor=07111A" alt="Versión: v0.0.1-genesis"></a>
  <a href="#estado"><img src="https://img.shields.io/badge/estado-experimental-FF7C6B?style=for-the-badge&labelColor=07111A" alt="Estado: experimental"></a>
  <a href="#tesis-de-trabajo"><img src="https://img.shields.io/badge/arquitectura-operation--first-36D9E6?style=for-the-badge&labelColor=07111A" alt="Arquitectura: operation-first"></a>
  <a href="#authority"><img src="https://img.shields.io/badge/authority-acotada-F3E8D0?style=for-the-badge&labelColor=07111A" alt="Authority: acotada"></a>
  <a href="#origen"><img src="https://img.shields.io/badge/genealog%C3%ADa-LUS%20%2B%20Lore-7FE0B7?style=for-the-badge&labelColor=07111A" alt="Genealogía: LUS + Lore"></a>
  <a href="./README.md"><img src="https://img.shields.io/badge/read-in%20English-FF557A?style=for-the-badge&labelColor=07111A" alt="Read in English"></a>
</p>

<p align="center">
  <b>Operational authority for heterogeneous intelligence.</b><br>
  Vespi explora cómo distintas inteligencias pueden trabajar juntas sin darle a ninguna más autoridad de la que necesita.
</p>

---



<table>
<tr>
<td width="33%" valign="top">

**Empezar**

[El problema](#el-problema) ·
[¿Qué es Vespi?](#qu%C3%A9-es-vespi) ·
[Tesis de trabajo](#tesis-de-trabajo)

</td>
<td width="33%" valign="top">

**Entender**

[Authority](#authority) ·
[Experimento Stellar](#experimento-stellar-actual) ·
[Cuerpos](#cuerpos-no-un-solo-cerebro) ·
[Genealogía](#origen)

</td>
<td width="33%" valign="top">

**Seguir**

[Método](#m%C3%A9todo-de-desarrollo) ·
[Estado](#estado) ·
[Historia pública](#historia-p%C3%BAblica) ·
[Génesis](./docs/GENESIS.md)

</td>
</tr>
</table>

---

## El problema

Los sistemas de agentes son cada vez mejores actuando, pero suelen colapsar varias cosas distintas en una sola:

- tener una capability;
- tener acceso a contexto;
- poder ver datos;
- poder gastar;
- poder ejecutar.

Vespi parte desde una premisa más estricta:

> **Capability no es authority. Context no es authority. Visibility no es authority.**

Un cuerpo puede saber algo sin poder modificarlo.  
Puede descubrir una capability sin poder comprarla.  
Puede recomendar una acción sin poder ejecutarla.  
Puede participar en una operación sin ver el sistema completo.

El objetivo no es maximizar autonomía. El objetivo es **hacer explícita la authority alrededor de operaciones acotadas**.

---

## ¿Qué es Vespi?

Vespi es un sistema experimental para componer **cuerpos heterogéneos** alrededor de operaciones con fronteras explícitas.

Esos cuerpos pueden usar distintos:

- modelos;
- Lores;
- tools;
- capabilities;
- niveles de contexto;
- permisos económicos;
- roles de revisión.

Algunos pueden ser deliberadamente ciegos. Algunos pueden persistir. Algunos pueden seguir existiendo fuera de la operación que los convocó.

La idea de trabajo actual es simple:

> **La unidad no es el agente. La unidad es la operación.**

---

<a id="tesis-de-trabajo"></a>
## Tesis de trabajo

Son provisionales. Están aquí para ser probadas, cambiadas o rechazadas.

- **Cuerpos distintos, authority acotada.**
- **La inteligencia útil también puede venir de lo que un cuerpo deliberadamente no sabe.**
- **Coordinar no exige una mente global compartida.**
- **El routing puede ocurrir por expertise o por diferencia útil.**
- **La evidencia debe ser suficiente para la operación, no una excusa para capturarlo todo.**
- **Un cuerpo puede importar porque sabe hacer el trabajo o porque cambia el espacio de decisiones posibles.**
- **La autonomía es opcional. La authority es explícita.**

---

<a id="authority"></a>
## Authority

Vespi trata la authority como no transitiva.

Que un cuerpo pueda:

- ver;
- clasificar;
- recomendar;
- recordar;
- pagar;
- firmar;
- desplegar;

no significa que otro cuerpo herede automáticamente ese permiso.

Esto importa especialmente cuando los sistemas de IA interactúan con dinero, identidad, datos privados, smart contracts o procesos regulados.

Una pregunta central de diseño es:

> **¿Qué debe ser capaz de ocurrir sin Vespi?**

Una colmena donde todo lo importante tiene que volver a la reina es un centro, no una colmena.

---

## Experimento Stellar actual

La primera dirección live es un flujo causal de adquisición de capability sobre Stellar:

```text
intent
→ missing capability
→ price
→ policy / budget
→ human gate
→ payment
→ capability unlocked
→ work continues
→ verification
→ receipt
```

La demostración buscada es:

> **Sin el pago autorizado, la capability no existe para la operación. Después del settlement, la operación puede hacer algo que antes no podía.**

El primer flagship se está construyendo sobre Stellar testnet y comercio de capabilities con x402, además de trabajo alrededor de identidad, autorización, patrones de smart contracts y verificación nativa de Stellar.

---

## Cuerpos, no un solo cerebro

Vespi se está diseñando para componer distintos tipos de cuerpos en vez de aplanarlos dentro de un "super-agente".

Roles bajo exploración:

- builder;
- blind reviewer;
- Lore-bound reviewer;
- adversarial reviewer;
- decision body;
- domain / network body;
- economic body;
- independent verifier;
- human arbiter.

Un cuerpo puede aportar precisamente porque usa otro modelo, otro Lore, menos contexto o una jurisdicción distinta.

---

<a id="origen"></a>
## Genealogía

Vespi no nace desde una hoja en blanco.

Emerge de varios años de trabajo alrededor de continuidad humano-IA, criterio portable, revisión, routing y límites entre agentes.

### LUS

LUS estudia cómo una relación humano-IA acumula criterio capaz de participar en decisiones futuras.

### Lore Plugin

Lore Plugin vuelve portable y operativo ese criterio entre proyectos, áreas, bots y hosts.

### Vespi

Vespi explora la capa siguiente:

> **¿Cómo coordinamos cuerpos heterogéneos, authority, capabilities y evidencia sin colapsarlos dentro de un único centro?**

Los tres están relacionados, pero no son la misma cosa.

---

## Frontera de procedencia

Vespi solo incorpora investigación, criterio o patrones de diseño que pertenezcan a Andrés, que ya formen parte del cuerpo de trabajo de LUS / Lore Plugin o que tengan autorización explícita para reutilizarse.

La investigación de colaboradores o de proyectos externos **no** se trata por defecto como insumo de Vespi. Que algo sea público no implica permiso para absorberlo dentro de la genealogía de investigación o del diseño del producto.

---

## Método de desarrollo

Vespi se construye en público.

El proceso hereda una disciplina ya ejercida en Lore Plugin:

```text
brainstorm
→ diseño aprobado
→ plan
→ test / verificación
→ commit
→ RC / release
→ observación
→ revisión
```

Una implementación que funciona no se vuelve automáticamente un resultado científico.  
Una buena idea no se vuelve automáticamente una feature.  
Un patrón externo no se adopta automáticamente.

Este repositorio busca conservar tanto lo que sobrevive como lo que se rechaza.

---

<a id="estado"></a>
## Estado

**Experimental.**

Dirección actual:

- génesis público;
- revisión canónica de LUS + Lore Plugin;
- Constitución candidata;
- flagship Stellar;
- modelo de bodies / authority / receipts;
- objetivo RC1;
- recipes y replays públicos.

Etiquetas del repositorio:

- `LIVE` — corre ahora;
- `REPLAY` — corrida preservada con evidencia;
- `BLUEPRINT` — diseñado, no implementado;
- `HYPOTHESIS` — pregunta de investigación, no claim de producto.

---

## Historia pública

No queremos escribir un origen perfecto al final.

Queremos dejar visible el origen mientras ocurre.

Este repositorio conservará:

- specs;
- decisiones;
- ideas rechazadas;
- tests;
- receipts;
- RCs;
- release notes;
- cambios de arquitectura;
- research lineage.

Ver [`docs/GENESIS.md`](./docs/GENESIS.md).

---

## ¿Por qué "Vespi"?

El nombre está ligado deliberadamente a la idea de colmena, pero no a una reina centralizada que posee a todos los cuerpos.

La metáfora actual es más exigente:

- los cuerpos pueden conservar sus propias historias;
- algunas relaciones pueden permanecer locales;
- no todo evento importante debe viajar al centro;
- la reina coordina sin poseer la colonia.

Esa tensión todavía se está diseñando.

---

## Autor

**Andrés Peña Mellado**

Digital Art Director & Creative Developer.  
Investigador y builder trabajando en la intersección entre agentes de IA, Web3, diseño, software y experimentación institucional.

<p>
  <a href="https://github.com/andresanemic"><img src="https://img.shields.io/badge/GitHub-andresanemic-07111A?style=for-the-badge&logo=github&logoColor=F3E8D0" alt="GitHub"></a>
  <a href="https://x.com/andresanemic"><img src="https://img.shields.io/badge/X-@andresanemic-FF7C6B?style=for-the-badge&logo=x&logoColor=07111A&labelColor=07111A" alt="X"></a>
  <a href="https://www.linkedin.com/in/andresanemic/"><img src="https://img.shields.io/badge/LinkedIn-Andr%C3%A9s%20Pe%C3%B1a%20Mellado-36D9E6?style=for-the-badge&logo=linkedin&logoColor=07111A&labelColor=07111A" alt="LinkedIn"></a>
</p>

---

## Licencia

Se definirá antes del primer release público.


---