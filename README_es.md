[![Vespiqueen genesis](./assets/vespiqueen-genesis.png)](./assets/vespiqueen-genesis.png)

# Vespi

<p align="center">
  <a href="https://github.com/andresanemic/vespi/releases/tag/v0.1.0-kernel"><img src="https://img.shields.io/badge/version-v0.1.0--kernel-D7B698?style=for-the-badge&labelColor=07111A" alt="Version: v0.1.0-kernel"></a>
  <a href="./docs/GENESIS.md"><img src="https://img.shields.io/badge/status-experimental-E0C170?style=for-the-badge&labelColor=07111A" alt="Status: experimental"></a>
</p>

[Read in English](./README.md)

Vespi es un pequeño experimento público sobre cómo personas, modelos y servicios pueden trabajar juntos sin compartir automáticamente el mismo contexto ni los mismos permisos.

Lo construye en público **Andrés Peña Mellado**.

Este repositorio empieza temprano a propósito. Vespi todavía no es un runtime terminado ni un protocolo estable. Lo que existe hoy es un génesis público: una pregunta, una manera provisional de pensar las operaciones y un lugar donde experimentos, errores y cambios de dirección puedan quedar visibles mientras ocurren.

## Qué existe hoy

- [`v0.0.1-genesis`](https://github.com/andresanemic/vespi/releases/tag/v0.0.1-genesis), el primer corte público.
- [`v0.1.0-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.0-kernel), primer código ejecutable: kernel mínimo + demo x402 en testnet.
- [`docs/GENESIS.md`](./docs/GENESIS.md), con el problema actual, las tesis de trabajo y aquello que todavía no afirmamos.
- [`experiments/`](./experiments/), el lugar público para las corridas. Primeras corridas completadas: [`001-operator-professor-loop`](./experiments/001-operator-professor-loop/RUN.md) (dos cuerpos, cero intervenciones humanas) y [`002-x402-slice1`](./experiments/002-x402-slice1/RUN.md) (capability pagada en Stellar testnet, con recibos y un fallo real conservado).
- [`src/`](./src/), kernel de operación ejecutable mínimo (cero dependencias, tests en verde — corre `node --test test/` con Node 24): goal → requirements → chequeo de authority → gate humano solo si falta → ejecutar → verificar → recibo. Ejercido contra x402/Stellar testnet vía [`demo/x402`](./demo/x402/README.md) — el único lugar que conoce x402. La misma operación frena sin authority y continúa con ella.

## Dirección de trabajo — no todo esto está implementado todavía

La supervisión humana gobierna los bordes de la operación, no cada acción adentro.

Usa la inteligencia suficiente más barata. La escalación debe ganarse.

Autonomía no es cuánto tiempo Vespi puede operar sin un humano. Es cuánto trabajo legítimo puede completar sin consumir atención humana innecesaria.

Cómo se separa la dirección:

- Lore → qué cuenta como buen trabajo acá.
- Perfil operativo del usuario → cómo prefiere trabajar esta persona.
- Authority → qué puede hacer el sistema sin preguntar.
- Política de modelos → cuánta inteligencia y costo puede gastar la operación.
- Vespi → continúa la operación dentro de esos bordes.

Implementado hoy: operación, authority acotada, gate humano, frontera de capability, verificación, recibo.

Sigue como dirección de diseño: perfiles operativos de usuario, economía y escalación de modelos, trabajo autónomo delegado más largo, batching del tipo "déjame cinco borradores y pregúntame solo donde mi criterio haga falta". Nada de eso se afirma como capability actual.
- Una primera dirección sobre Stellar testnet, todavía en desarrollo y no presentada como una capability ya publicada.

> **La unidad no es el agente. La unidad es la operación.**\
> *Tesis de trabajo.*

## De dónde viene

Vespi nace del trabajo de **Andrés Peña Mellado** en **[LUS](https://github.com/andresanemic/lore-plugin/blob/main/docs/LUS_en.md)** y **[Lore Plugin](https://github.com/andresanemic/lore-plugin)**, pero es un proyecto separado, con su propia historia.

**LUS** estudia cómo el trabajo compartido entre humano e IA puede convertirse en criterio reutilizable que modifica decisiones posteriores.

**Lore Plugin** vuelve ese criterio acumulado utilizable entre proyectos, bots y modelos.

Vespi hace otra pregunta: ¿qué ocurre cuando participantes distintos necesitan coordinarse sin compartir automáticamente el mismo contexto, permisos o historia?

La relación importa, pero también sus fronteras. El trabajo de colaboradores o proyectos vecinos no se convierte en input de Vespi por proximidad. La frontera de procedencia vigente está registrada en [`GENESIS.md`](./docs/GENESIS.md).

## ¿Por qué publicarlo tan temprano?

Porque la historia también es evidencia.

Vespi no debería aparecer después con un relato de origen perfecto. Lo que sobreviva, lo que falle, lo que cambie y lo que sea rechazado debería quedar inspeccionable mientras el proyecto todavía se está convirtiendo en sí mismo.

## Autor

**Andrés Peña Mellado**\
Digital Art Director & Creative Developer trabajando entre agentes de IA, Web3, diseño e investigación.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/) &nbsp;&nbsp; <img src="./assets/icons/v2/discord.svg" width="28" alt="Discord">

---

[Génesis](./docs/GENESIS.md) · [Changelog](./CHANGELOG.md) · [Experimentos](./experiments/) · [Release v0.1.0-kernel](https://github.com/andresanemic/vespi/releases/tag/v0.1.0-kernel) · [Licencia MIT](./LICENSE)
