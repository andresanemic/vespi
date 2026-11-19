export function profileMessage(account: string, displayName: string, expiresAt: number) {
  return new TextEncoder().encode(JSON.stringify(['vespi:contribution-profile:v1:stellar:testnet', account, displayName, expiresAt]));
}
