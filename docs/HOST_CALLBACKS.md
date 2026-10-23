# Host callbacks in the 0.1.8 kernel

Kernel 0.1.8 invokes host callbacks without a receiver, using an undefined `thisArg`. This covers `runOperation` callbacks supplied through `io`, x402 callbacks and x402 ports. The 0.1.7 implementation bound several operation callbacks to `io`.

Use arrow functions, closures or explicitly bound functions. A method that needs its owning object must be bound before it is passed to the kernel:

```js
const io = {
  ask: request => approvals.ask(request),
  verify: verifier.verify.bind(verifier),
};
```

Do not depend on the kernel setting `this === io` or `this === ports`. Strict functions receive `this === undefined`; ordinary non-strict functions follow JavaScript's receiver conversion rules, and arrow/bound functions retain their own binding. This is a callback contract, not a process isolation guarantee.

Callbacks may return synchronous values or supported native promises. The continuation tests cover both. Non-native thenables are rejected without subscribing to their `then` method; promise subclasses with custom `Symbol.species` remain outside the exercised compatibility coverage of this version.

The host remains responsible for its clock, truthful context and verification ports, checkpoint authenticity, durable checkpoint storage and minimum accepted generation, and durable claims storage where required. A checkpoint digest provides integrity, not authorship. Signal revocation requires cooperative ports; it does not terminate arbitrary host code or prevent a capability from using its own network access.

This note describes the callback contract; it does not establish validation of every external consumer. The local consumer inventory found arrows/closures or explicitly bound callbacks, with its static-analysis limits recorded separately.
