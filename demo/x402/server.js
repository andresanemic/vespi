/**
 * Reference paid endpoint for the Vespi demo (NOT production).
 *
 * Serves ONE operation behind official x402 v2 on Stellar testnet:
 *   GET /api/agent-service?service=marketing-plan
 * Unknown service -> 400 before any payment dance. No payTo configured -> 503.
 * Run: BORA_PAY_TO=G... node server.js   (then the demo runner in a second terminal)
 */
import express from 'express';
import { claimPayment } from './idempotency.js';
import { paymentMiddlewareFromConfig } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import { isValidPublicKey } from './config.js';

const NETWORK = 'stellar:testnet';
const PRICE = '$0.01';
const ROUTE_PATH = '/api/agent-service';
const PORT = Number(process.env.PORT || 3777);
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';
const PAY_TO = process.env.BORA_PAY_TO || '';

const app = express();
app.use(express.json());

if (!isValidPublicKey(PAY_TO)) {
  app.use((_req, res) => res.status(503).json({ error: 'BORA_PAY_TO must be a valid Stellar G... public key. Refusing to serve.' }));
} else {
  app.use(ROUTE_PATH, (req, res, next) => {
    if ((req.query.service || 'marketing-plan') !== 'marketing-plan') {
      res.status(400).json({ error: 'Unknown service', supported: ['marketing-plan'] });
      return;
    }
    next();
  });
  app.use(
    paymentMiddlewareFromConfig(
      { [`GET ${ROUTE_PATH}`]: { accepts: { scheme: 'exact', price: PRICE, network: NETWORK, payTo: PAY_TO } } },
      new HTTPFacilitatorClient({ url: FACILITATOR_URL }),
      [{ network: NETWORK, server: new ExactStellarScheme() }]
    )
  );
  app.get(ROUTE_PATH, (req, res) => {
    const paymentClaim = claimPayment(req.get('payment-signature') || req.get('x-payment'));
    if (paymentClaim === 'invalid') {
      res.status(400).json({ error: 'Invalid payment header' });
      return;
    }
    if (paymentClaim === 'duplicate') {
      res.status(409).json({ error: 'Payment already processed' });
      return;
    }
    if (paymentClaim === 'capacity') {
      res.status(503).json({ error: 'Payment idempotency capacity reached' });
      return;
    }
    res.json({
      service: 'marketing-plan',
      paid: true,
      paidAt: new Date().toISOString(),
      title: 'AI BORA Marketing Plan',
      summary: 'A 90-day plan to move your B2B sales to on-chain proposals and instant settlements.',
      deliverables: [
        'Landing page A/B test variants (hero copy + CTA)',
        'LinkedIn outreach sequence for decision makers',
        'On-chain proposal explainer video script',
      ],
      nextSteps: ['Launch week 1 campaign', 'Track proposal conversions on Stellar', 'Retarget warm leads'],
    });
  });
}

app.listen(PORT, () => console.log(`demo paid endpoint on http://localhost:${PORT}${ROUTE_PATH}`));
