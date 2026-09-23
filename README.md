[![Vespiqueen genesis](./assets/vespiqueen-genesis.png)](./assets/vespiqueen-genesis.png)

# Vespi

<p align="center">
  <a href="https://github.com/andresanemic/vespi/releases/tag/v0.1.0-kernel"><img src="https://img.shields.io/badge/version-v0.1.0--kernel-D7B698?style=for-the-badge&labelColor=07111A" alt="Version: v0.1.0-kernel"></a>
  <a href="./docs/GENESIS.md"><img src="https://img.shields.io/badge/status-experimental-E0C170?style=for-the-badge&labelColor=07111A" alt="Status: experimental"></a>
</p>

[Leer en español](./README_es.md)

Vespi is a small public experiment in how people, models and services can work together without automatically sharing the same context or permissions.

It is being built in public by **Andrés Peña Mellado**.

This repository starts early on purpose. Vespi is not a finished runtime or a stable protocol. What exists today is a public genesis: a question, a provisional way of thinking about operations, and a place where experiments, mistakes and changes of direction can remain visible as they happen.

## What exists today

- [`v0.0.1-genesis`](https://github.com/andresanemic/vespi/releases/tag/v0.0.1-genesis), the first public snapshot.
- [`v0.1.0-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.0-kernel), first executable code: minimal kernel + x402 testnet demo.
- [`docs/GENESIS.md`](./docs/GENESIS.md), the current problem statement, working theses and non-claims.
- [`experiments/`](./experiments/), the public place for runs. First completed runs: [`001-operator-professor-loop`](./experiments/001-operator-professor-loop/RUN.md) (two bodies, zero human interventions) and [`002-x402-slice1`](./experiments/002-x402-slice1/RUN.md) (paid capability on Stellar testnet, with receipts and one kept failure).
- [`src/`](./src/), a minimal executable operation kernel (zero dependencies, tests green — run `node --test test/` with Node 24): goal → requirements → authority check → human gate only when insufficient → execute → verify → receipt. Exercised against x402/Stellar testnet via [`demo/x402`](./demo/x402/README.md) — the only place that knows x402. Same operation gates without authority and continues with it.

## Working direction — not all of this is implemented yet

Human oversight governs the boundaries of the operation, not every action inside it.

Use the least expensive sufficient intelligence. Escalation must be earned.

Autonomy is not how long Vespi can operate without a human. It is how much legitimate work it can complete without consuming unnecessary human attention.

How the direction separates:

- Lore → what counts as good work here.
- User operating profile → how this person prefers to work.
- Authority → what the system may do without asking.
- Model policy → how much intelligence and cost the operation may spend.
- Vespi → continues the operation within those bounds.

Implemented today: operation, bounded authority, human gate, capability boundary, verification, receipt.

Still design direction: user operating profiles, model economy and escalation, longer delegated autonomous work, batching like "leave me five drafts and ask only where my judgment is actually needed". None of that is claimed as current capability.
- A first direction on Stellar testnet, still under development and not presented as a shipped capability.

> **The unit is not the agent. The unit is the operation.**\
> *Working thesis.*

## Where it comes from

Vespi grows out of **Andrés Peña Mellado's** work on **[LUS](https://github.com/andresanemic/lore-plugin/blob/main/docs/LUS_en.md)** and **[Lore Plugin](https://github.com/andresanemic/lore-plugin)**, but it is a separate project with its own history.

**LUS** studies how shared human–AI work can become reusable judgment that shapes later decisions.

**Lore Plugin** makes that accumulated judgment usable across projects, bots and models.

Vespi asks a different question: what happens when distinct participants need to coordinate without automatically sharing the same context, permissions or history?

The relationship matters, but so do the boundaries. Work from collaborators or neighboring projects does not become Vespi input by proximity. The current provenance boundary is recorded in [`GENESIS.md`](./docs/GENESIS.md).

## Why publish this early?

Because the history is part of the evidence.

Vespi should not arrive later with a polished origin story. What survives, what fails, what changes and what gets rejected should remain inspectable while the project is still becoming itself.

## Author

**Andrés Peña Mellado**\
Digital Art Director & Creative Developer working across AI agents, Web3, design and research.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/) &nbsp;&nbsp; <img src="./assets/icons/v2/discord.svg" width="28" alt="Discord">

---

[Genesis](./docs/GENESIS.md) · [Changelog](./CHANGELOG.md) · [Experiments](./experiments/) · [Release v0.1.0-kernel](https://github.com/andresanemic/vespi/releases/tag/v0.1.0-kernel) · [MIT License](./LICENSE)
