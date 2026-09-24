# VESPI — GENESIS
**Draft · 2026-09-22**

> Historical origin and working theses. The current local implementation and support status are maintained in `README.md` and `CHANGELOG.md`.

> **Vespi is being defined in public. This repository records not only what survives, but what gets rejected.**

## Why this repository exists

AI systems are getting better at acting, but capability, context and authority are often collapsed into the same thing.

Give an agent a tool and it can use it.  
Give it context and it can see it.  
Give it a wallet and it can spend.  
Give it memory and every future operation may inherit it.

Vespi starts from a different question:

> **How can different intelligences work together without giving any of them more authority than they need?**

That question emerged from practical work with LUS, Lore Plugin, multi-model workflows, blind reviewers, human arbitration and real agentic development.

This repository is the attempt to build the answer.

## Working theses

These are provisional. They may change.

- The unit is not the agent. The unit is the operation.
- Capability is not authority.
- Context is not authority.
- Visibility is not authority.
- Useful intelligence can come from what a body deliberately does not know.
- Different bodies do not need a shared global mind to collaborate.
- Evidence should be sufficient for the operation, not an excuse for total capture.
- A body may matter because of expertise — or because it changes the space of possible decisions.
- Vespiqueen returns time; it does not claim it.

Vespiqueen is not a hyperproductivity system. Its purpose is not to fill every recovered minute with more output, but to return time and agency to people. A capability is not judged only by additional output, but also by whether it reduces unnecessary load and preserves time and agency for the person to decide.

Vespiqueen is the surrounding hive and continuity direction; Vespi is the current operation kernel. The visual identity does not represent a second runtime.

## What Vespi is not claiming yet

Vespi is not currently presented as:

- a proven general theory of multi-agent systems;
- a finished autonomous-agent runtime;
- a compliance product;
- an SSI standard;
- a universal wallet;
- a replacement for Lore Plugin;
- evidence that one architecture solves every coordination problem.

Anything marked RC, REPLAY, BLUEPRINT, hypothesis or research lineage should remain visibly different.

## Where it comes from

### LUS
A research program about continuity of criterion and the relational space in which humans and AI accumulate it.

### Lore Plugin
An operational system for making accumulated criterion portable, routable and able to govern future decisions through explicit skills and thresholds across projects, areas, bots and hosts.

### Vespi
A future direction for composing heterogeneous bodies, bounded authority, capabilities, economic actions, verification and operations across those bodies.

The boundaries between these three matter.

## Development method

Vespi inherits a discipline already used publicly in Lore Plugin:

`brainstorm → approved design → plan → TDD / verification → commit → RC/release → observe → revise`

A successful implementation is not automatically a scientific result.
A good idea is not automatically a feature.
An external pattern is not automatically adopted.

## Current experiment

The first Stellar flagship explores a causal capability acquisition flow:

`intent → missing capability → price → policy/budget → human gate → payment → capability unlocked → work continues → verification → receipt`

The intended demonstration is the full flow the experiment seeks to exercise.

> **In the intended flow, without authorized payment the capability is unavailable to the operation; only after a verified settlement can the operation do what it could not do before.**

Current evidence distinguishes the locally/offline-verified pre-signature x402 boundary from the network stages: after the RUN 05 repairs, a fresh testnet 402 response, real signing, facilitator, settlement and Horizon verification remain **CURRENT TESTNET NOT VERIFIED**; historical testnet evidence remains historical.

## The uncomfortable requirement

Vespi should also be able to tolerate things that happen outside its field of view.

A hive where everything important must return to the queen is a center, not a hive.

So one of the open questions of this repository is:

> **What must be able to happen without Vespi?**

## Status

**Current repository state:** Experimental. RUN 05 is closed within its declared evaluation scope; it is not a released first-party `vespi` skill and not a closed general continuity runtime.

**Historical state:** An earlier RC1-oriented phase remains in the history. It is not the current release state. Architecture is still being arbitrated, and history is intentionally preserved.

## Working direction: bounded autonomy (not implemented yet — do not read as capability)

Human oversight governs the boundaries of the operation, not every action inside it.

Use the least expensive sufficient intelligence. Escalation must be earned.

Autonomy is not how long Vespi can operate without a human. It is how much legitimate work it can complete without consuming unnecessary human attention.

The direction separates five things that must not collapse into each other:

- Lore → what counts as good work here.
- User operating profile → how this person prefers to work.
- Authority → what the system may do without asking.
- Model policy → how much intelligence and cost the operation may spend.
- Vespi → continues the operation within those bounds.

Implemented today in the local kernel: bounded operation execution, authority checking, a human decision surface, declared spend requirements per capability, separate local verification hooks and structured receipts.

Still design direction: automatic durable persistence, user operating profiles, model economy and escalation, longer delegated autonomous work, batching work and asking only where judgment is actually needed.

## Provenance boundary

Vespi does not absorb collaborators' research by proximity.

Only work owned by Andrés, already belonging to the LUS / Lore Plugin lineage, or explicitly authorized for reuse can enter Vespi as research lineage, design evidence or product primitive.

In particular, **RUC-D and Web3 Trust Native are excluded from Vespi's research inputs and perturbation set**. They are work associated with collaborators in the Blockchain Lab UAI context and are not being incorporated into Vespi without permission.