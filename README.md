<!-- Hero image pending: keep this slot empty until the visual board is approved. -->

<h1 align="center">Vespi</h1>

<p align="center">
  <a href="#status"><img src="https://img.shields.io/badge/version-v0.0.1--genesis-FF7C6B?style=for-the-badge&labelColor=07111A" alt="Version: v0.0.1-genesis"></a>
  <a href="#status"><img src="https://img.shields.io/badge/status-experimental-FF7C6B?style=for-the-badge&labelColor=07111A" alt="Status: experimental"></a>
  <a href="#working-theses"><img src="https://img.shields.io/badge/architecture-operation--first-36D9E6?style=for-the-badge&labelColor=07111A" alt="Architecture: operation-first"></a>
  <a href="#authority"><img src="https://img.shields.io/badge/authority-bounded-F3E8D0?style=for-the-badge&labelColor=07111A" alt="Authority: bounded"></a>
  <a href="#origin"><img src="https://img.shields.io/badge/research-lineage-LUS%20%2B%20Lore-7FE0B7?style=for-the-badge&labelColor=07111A" alt="Research lineage: LUS + Lore"></a>
  <a href="./README_es.md"><img src="https://img.shields.io/badge/leer-en%20espa%C3%B1ol-FF557A?style=for-the-badge&labelColor=07111A" alt="Read in Spanish"></a>
</p>

<p align="center">
  <b>Operational authority for heterogeneous intelligence.</b><br>
  Vespi explores how different intelligences can work together without giving any of them more authority than they need.
</p>

---


<table>
<tr>
<td width="33%" valign="top">

**Start**

[The problem](#the-problem) ·
[What is Vespi?](#what-is-vespi) ·
[Working theses](#working-theses)

</td>
<td width="33%" valign="top">

**Understand**

[Authority](#authority) ·
[Stellar experiment](#current-stellar-experiment) ·
[Bodies](#bodies-not-one-brain) ·
[Research lineage](#origin)

</td>
<td width="33%" valign="top">

**Follow**

[Method](#development-method) ·
[Status](#status) ·
[Public history](#public-history) ·
[Genesis](./docs/GENESIS.md)

</td>
</tr>
</table>

---

## The problem

Agent systems are getting better at acting, but they often collapse several different things into one:

- having a capability;
- having access to context;
- being able to see data;
- being allowed to spend;
- being allowed to execute.

Vespi starts from a stricter premise:

> **Capability is not authority. Context is not authority. Visibility is not authority.**

A body may know something without being allowed to change it.  
It may discover a capability without being allowed to buy it.  
It may recommend an action without being allowed to execute it.  
It may participate in an operation without seeing the whole system.

The goal is not maximum autonomy. The goal is **explicit authority around bounded operations**.

---

## What is Vespi?

Vespi is an experimental system for composing **heterogeneous bodies** around operations with explicit boundaries.

Those bodies may use different:

- models;
- Lores;
- tools;
- capabilities;
- levels of context;
- economic permissions;
- review roles.

Some may be intentionally blind. Some may be persistent. Some may exist outside the operation that called them.

The current working idea is simple:

> **The unit is not the agent. The unit is the operation.**

---

## Working theses

These are provisional. They are here to be tested, changed or rejected.

- **Different bodies, bounded authority.**
- **Useful intelligence can come from what a body deliberately does not know.**
- **Coordination does not require a shared global mind.**
- **Routing can happen by expertise or by useful difference.**
- **Evidence should be sufficient for the operation, not an excuse for total capture.**
- **A body may matter because it can do the work, or because it changes the space of possible decisions.**
- **Autonomy is optional. Authority is explicit.**

---

<a id="authority"></a>
## Authority

Vespi treats authority as non-transitive.

If one body can:

- see;
- classify;
- recommend;
- remember;
- pay;
- sign;
- deploy;

that does not imply that another body automatically inherits the same permission.

This matters for AI systems that interact with money, identity, private data, smart contracts or regulated workflows.

A core design question is:

> **What must be able to happen without Vespi?**

A hive where everything important must return to the queen is a center, not a hive.

---

## Current Stellar experiment

The first live direction is a causal capability-acquisition flow on Stellar:

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

The intended demonstration is:

> **Without the authorized payment, the capability does not exist for the operation. After settlement, the operation can do something it could not do before.**

The first flagship is being built around Stellar testnet and x402-style capability commerce, with additional work around Stellar-native identity, authorization, smart-contract patterns and verification.

---

## Bodies, not one brain

Vespi is being designed to compose different kinds of bodies instead of flattening them into one "super-agent".

Examples under exploration include:

- builder;
- blind reviewer;
- Lore-bound reviewer;
- adversarial reviewer;
- decision body;
- domain / network body;
- economic body;
- independent verifier;
- human arbiter.

A body may contribute precisely because it has a different model, a different Lore, less context or a different jurisdiction.

---

<a id="origin"></a>
## Research lineage

Vespi did not start as a clean-sheet architecture.

It emerges from several years of work around human-AI continuity, portable criteria, review, routing and agent boundaries.

### LUS

LUS studies how a human-AI relation accumulates criteria that can participate in later decisions.

### Lore Plugin

Lore Plugin makes accumulated criteria portable and operational across projects, areas, bots and hosts.

### Vespi

Vespi explores the next layer:

> **How do heterogeneous bodies coordinate operations, authority, capabilities and evidence without collapsing into a single center?**

These three are related, but they are not the same thing.

---

## Provenance boundary

Vespi only incorporates research, criteria or design patterns that Andrés owns, that are already part of the LUS / Lore Plugin body of work, or that are explicitly authorized for reuse.

Research belonging to collaborators or external projects is **not** treated as Vespi input by default. Public availability does not imply permission to absorb it into Vespi's research lineage or product design.

---

## Development method

Vespi is being built in public.

The development process inherits a discipline already exercised in Lore Plugin:

```text
brainstorm
→ approved design
→ plan
→ test / verify
→ commit
→ RC / release
→ observe
→ revise
```

A successful implementation is not automatically a scientific result.  
A good idea is not automatically a feature.  
An external pattern is not automatically adopted.

This repository is meant to preserve both what survives and what gets rejected.

---

<a id="status"></a>
## Status

**Experimental.**

Current direction:

- public genesis;
- canonical review of LUS + Lore Plugin;
- constitution candidate;
- Stellar flagship;
- body / authority / receipt model;
- RC1 target;
- public recipes and replays.

Labels used in this repository:

- `LIVE` — runs now;
- `REPLAY` — preserved run with evidence;
- `BLUEPRINT` — designed, not implemented;
- `HYPOTHESIS` — research question, not product claim.

---

## Public history

The point is not to publish a polished origin story later.

The point is to leave the origin visible while it happens.

This repository will preserve:

- specs;
- decisions;
- rejected ideas;
- tests;
- receipts;
- RCs;
- release notes;
- architecture changes;
- research lineage.

See [`docs/GENESIS.md`](./docs/GENESIS.md).

---

## Why "Vespi"?

The name is intentionally tied to the idea of a hive, but not to a centralized queen that owns every body.

The current metaphor is more demanding:

- bodies can keep their own histories;
- some relationships may remain local;
- not every important event must travel to the center;
- the queen coordinates without owning the colony.

That tension is still being designed.

---

## Author

**Andrés Peña Mellado**

Digital Art Director & Creative Developer.  
Researcher and builder working across AI agents, Web3, design, software and institutional experimentation.

<p>
  <a href="https://github.com/andresanemic"><img src="https://img.shields.io/badge/GitHub-andresanemic-07111A?style=for-the-badge&logo=github&logoColor=F3E8D0" alt="GitHub"></a>
  <a href="https://x.com/andresanemic"><img src="https://img.shields.io/badge/X-@andresanemic-FF7C6B?style=for-the-badge&logo=x&logoColor=07111A&labelColor=07111A" alt="X"></a>
  <a href="https://www.linkedin.com/in/andresanemic/"><img src="https://img.shields.io/badge/LinkedIn-Andr%C3%A9s%20Pe%C3%B1a%20Mellado-36D9E6?style=for-the-badge&logo=linkedin&logoColor=07111A&labelColor=07111A" alt="LinkedIn"></a>
</p>

---

## License

To be defined before the first public release.


---