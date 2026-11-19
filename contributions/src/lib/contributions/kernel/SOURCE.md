# Kernel copy

These six files are a fixed copy of the Vespi kernel receipt modules.

- Commit: `005d7b8` of the kernel repo (`https://github.com/andresanemic/vespi/commit/005d7b8`).
- Origin: `src/contributions.js`, `src/receipt.js`, `src/context.js`, `src/time.js`, `src/zk.js` and `src/authority.js`.
- Do not edit: change the source and re-copy.

Each file starts with three comment lines of provenance; the rest is the kernel source byte for byte. `src/lib/contributions/kernel.test.ts` checks the sha256 of each body against the kernel commit.
