# Vespi Contributions chain evidence

The evidence shows that the accounts signed these receipt bytes and in which order. It does not establish whether the contribution was good or true.

1. Follow `index.json` from the request through the contribution to the acceptance.
2. Compute the SHA-256 of each file in `receipts/` as stored. It must match the file's digest and the transaction's `MEMO_HASH`.
3. Compare each receipt's `prev` with the preceding file's digest. The request has a null predecessor.
4. Follow the explorer links to confirm the network and ledger. In `transactions.json`, the fee-bump XDR contains the actor’s signed transaction. Its outer hash is the ledger transaction hash, and its fee source is the sponsor.
5. If the first contribution has an `assignment`, verify its SEP-53 signature with the requester’s account over the JSON array `["vespi:contribution-assignment:v1:<network>", "<root>", "<contributor>"]` serialized without spaces.

Each receipt contains the statement and comment exactly as signed. This package is published with the consent of both participants.
