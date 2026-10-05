'use strict';

// A SIMULATED authentication port for the tests. It is not an identity provider and it proves
// nothing about anybody: it answers with a frozen object per declared name, and that object is the
// whole contract `src/emergency.js` asks a host for.
//
//   authenticate({ grantId, role, name }) → a frozen object, the SAME one for every call that means
//   the same person, and a DIFFERENT one for a different person.
//
// The kernel never reads a field of a principal and never copies one: it brands what its port issued
// and compares principals by reference. So the only way two principals become equal is this file
// handing back the same object, and the only way a caller can be somebody is being given one. A real
// host (Casa Firme, Vela) replaces this file with whatever it trusts — a session, a signature, a
// directory — and changes nothing else in the module's contract.
//
// `aliases` exists so a test can say that two names are the same person on purpose. That is how the
// alias case is proved refused: the kernel has to notice two different names arriving as one
// principal, which it can only do because the port, not the text, decides.

function createHost() {
  const byPrincipal = new Map();
  const aliases = new Map();
  const host = {
    aliases,
    authenticate(claim) {
      // Read once, both fields, and refuse to guess: the kernel sends a frozen claim of its own, so a
      // malformed one is a host bug and an exception is this file's own failure. Either way it must
      // not hand a principal back.
      if (!claim || typeof claim !== 'object' || typeof claim.name !== 'string') {
        throw new Error('simulated host: the claim names nobody');
      }
      const name = aliases.has(claim.name) ? aliases.get(claim.name) : claim.name;
      if (!byPrincipal.has(name)) byPrincipal.set(name, Object.freeze({ principal: `simulated:${name}` }));
      return byPrincipal.get(name);
    },
    // The principal for a declared name, as a host would hand it to whoever it authenticated.
    principal(name) {
      return host.authenticate(Object.freeze({ grantId: 'test', role: 'test', name }));
    },
  };
  return host;
}

module.exports = { createHost };