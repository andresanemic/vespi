export function photoUploadMessage(actor: string, sha256: string, expiresAt: number): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(
    ['vespi:contribution-photo:v1:stellar:testnet', actor, sha256, expiresAt],
  ));
}
