<!-- Kernel commit 1f558b8 (vespi kernel repo). Source: docs/CONTRIBUTIONS_RECEIPT_V1.md. Do not edit: change the source and re-copy. -->
# Vespi Contributions receipt schema v1

This document describes the receipt format implemented by `src/contributions.js`. The contribution schema version is `version: 1`.

## Receipt fields

Every contribution receipt has exactly these eleven fields. `buildContribution` reads only own enumerable data properties named here: any other own key (symbols included) is rejected as unexpected, accessors and non-enumerable properties are rejected without being read, a proxy is rejected without running its traps, and inherited properties are not read. `version` may be omitted and is then set to `1`.

| Field | Meaning and constraints |
|---|---|
| `version` | Schema version, fixed to `1`. |
| `chain` | Lowercase 64-character hexadecimal chain identifier for `CONTRIBUTE`, `ACCEPT`, and `ATTEST`; otherwise `null`. |
| `kind` | One of the six kinds below. |
| `role` | Must match the role assigned to the kind below. |
| `actor` | Text matching `^G[A-Z2-7]{55}$`; this checks the public-key shape only, not a Stellar StrKey checksum. |
| `statement` | NFC text containing 1–1,000 UTF-16 code units (`.length`), without the invisible format characters U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+2066–U+2069, and U+FEFF. |
| `comment` | `null` or NFC text of at most 280 UTF-16 code units (`.length`), without the same invisible format characters as `statement`. |
| `subject` | Lowercase 64-character hexadecimal reference for `ACCEPT` and `ATTEST`; otherwise `null`. |
| `prev` | Lowercase 64-character hexadecimal digest of the preceding receipt for `CONTRIBUTE` and `ACCEPT`; otherwise `null`. |
| `evidence` | Kind-specific evidence described below. It is copied and deeply frozen. It may contain only `null`, strings, booleans, finite numbers, plain objects (prototype `Object.prototype` or `null`), and arrays (prototype `Array.prototype`). Functions, `undefined`, bigint, symbols, non-finite numbers, accessors, proxies, and cycles are rejected; so are symbol keys, non-enumerable own properties, arrays with holes or with keys other than their indices, and any other object such as `Date`, `Map`, or a class instance. |
| `createdAt` | ISO 8601 UTC timestamp with milliseconds, in the exact form returned by `new Date(value).toISOString()`. |

| Kind | Role | `chain` | `prev` | `subject` | Evidence |
|---|---|---|---|---|---|
| `REQUEST` | `requester` | `null` | `null` | `null` | `null` or a reference. |
| `CONTRIBUTE` | `contributor` | digest | previous digest | `null` | `null` or a reference. |
| `ACCEPT` | `requester` | digest | previous digest | digest of a contribution | `null` or a reference. |
| `ATTEST` | `observer` | digest | `null` | digest | `null` or a reference. |
| `SURVEY` | `respondent` | `null` | `null` | `null` | A survey commitment. |
| `REPORT` | `organizer` | `null` | `null` | `null` | Aggregate report evidence. |

Hexadecimal values are lowercase only. A reference is `null` or `{ "uri": "https://…", "sha256": "<64 lowercase hex characters>" }`.

## Canonical bytes and digest

Canonical receipt bytes are UTF-8 JSON from `JSON.stringify(canonicalize(receipt))`, where `canonicalize` is exported by `src/receipt.js` and recursively sorts object keys. `contributionDigest` uses the kernel's `computeDigest`, which hashes that canonical JSON with SHA-256 and returns lowercase hexadecimal. `canonicalBytes` and `contributionDigest` first pass their input through `buildContribution`, so invalid input, including a raw object with a `digest` or `anchor` key, throws instead of being hashed; input without `version` gets `version: 1`.

`parseContribution(bytes)` reads a published receipt. It requires a string, parses it as JSON, builds the receipt with `buildContribution`, and requires `canonicalBytes(receipt) === bytes`. Published bytes must therefore be exactly the canonical bytes: `version` present, keys in canonical order, no whitespace, and no other JSON spelling of the same value (such as `1.0` or a `\u` escape). Anything else throws (for invalid content, an error whose message starts with `contribution:`). For accepted bytes, the SHA-256 of the bytes equals `contributionDigest(parseContribution(bytes))`. The receipt digest is the value a Stellar `MEMO_HASH` anchor must use; a later anchoring verifier checks it. This module does not verify signatures or anchors.

## Chains

An empty list fails with `empty`; the first receipt must be a `REQUEST` (`first-not-request` otherwise), whose digest is `chainId`. A lone `REQUEST` is a valid open chain. Every later item must be a `CONTRIBUTE` or `ACCEPT` (`unexpected-kind` otherwise), name that `chainId` (`wrong-chain` otherwise), and set `prev` to the preceding receipt digest (`broken-prev` otherwise). All `CONTRIBUTE` receipts must have the same actor (`contributor-changed` otherwise). At most one `ACCEPT` is allowed (`accept-not-last` if it is not last); it must follow a contribution (`unexpected-kind` otherwise), be issued by the requester (`accept-by-non-requester` otherwise), and refer to a `CONTRIBUTE` digest in the chain (`accept-subject-not-in-chain` otherwise). `ATTEST`, `SURVEY`, and `REPORT` are not chain items. Repeated receipt digests fail with `duplicate`.

`verifyChain` returns these reasons for chain rule failures. Non-array inputs throw an error whose message starts with `contribution:`. If `buildContribution` rejects an item, its exception likewise propagates instead of a reason result.

## Survey and report evidence

`SURVEY.evidence` is exactly `{ "commitment": "<64 lowercase hex characters>" }`. `surveyCommitment` requires `answer` to be a non-array object and applies the same data rules as `evidence`. It hashes the salt decoded from lowercase hexadecimal into raw bytes, followed by UTF-8 `JSON.stringify(canonicalize(answer))`. The salt contains an even number of lowercase hex characters and at least 32 characters (128 bits).

`REPORT.evidence` has exactly `surveys`, `commitments`, `counts`, and `aggregate`. `surveys` and `commitments` are arrays of unique lowercase 64-character hex strings. `counts` has exactly nonnegative integer fields `withAccount`, `withoutAccount`, and `fallbackForm`; `counts.withAccount === surveys.length`, and the commitments length equals the sum of all three counts. `aggregate` is an object whose values are strings, booleans, or finite numbers. The `withAccount` check only compares it with `surveys.length`; whether those digests belong to anchored `SURVEY` receipts is not checked. This module does not check this; the planned verifier will. `withoutAccount`, `fallbackForm`, and aggregate figures are organizer assertions, with only the listed total-length consistency check on commitments. The receipt verifies acknowledgement and integrity, not the quality of the contribution.

## Index entry

`buildIndexEntry` returns a frozen entry with `version: 1`, `digest`, `network`, `txHash`, `ledger`, `envelopeXdr`, and `rehearsal`. The two hashes are lowercase 64-character hex; `network` is `stellar:testnet` or `stellar:pubnet`; `ledger` is a positive integer; `envelopeXdr` is nonempty base64; and `rehearsal` is boolean. Its input follows the same strict rule as `buildContribution`: it reads only own enumerable data properties among those six fields and an optional `version`, which must be `1`; any other own key is rejected as unexpected, and accessors, non-enumerable properties, and proxies are rejected without being read.
