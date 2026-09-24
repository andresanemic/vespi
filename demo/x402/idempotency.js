import { createHash } from 'node:crypto';

const MAX_PAYMENT_KEYS = 10_000;
const seenPayments = new Set();

function claimPayment(header) {
  if (typeof header !== 'string' || !header.trim()) return 'absent';
  if (header.length > 16_384) return 'invalid';
  const key = createHash('sha256').update(header).digest('hex');
  if (seenPayments.has(key)) return 'duplicate';
  if (seenPayments.size >= MAX_PAYMENT_KEYS) return 'capacity';
  seenPayments.add(key);
  return 'claimed';
}

export { claimPayment };
