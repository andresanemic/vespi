const SCALE = 10_000_000n;

function parseUsdc(value) {
  const text = String(value);
  if (text.length > 32 || !/^\d+(?:\.\d{1,7})?$/.test(text)) throw new Error('Invalid max USDC');
  const [whole, fraction = ''] = text.split('.');
  return (BigInt(whole) * SCALE + BigInt((fraction + '0000000').slice(0, 7))).toString();
}

export { parseUsdc };
