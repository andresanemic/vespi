export function assignmentMessage(chain: string, contributor: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(['vespi:contribution-assignment:v1:stellar:testnet', chain, contributor]));
}
