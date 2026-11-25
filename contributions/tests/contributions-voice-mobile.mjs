// Run with node --import ./src/lib/contributions/test-imports.mjs tests/contributions-voice-mobile.mjs
process.env.VESPI_TEST_VOICE = '1';
await import('./contributions-mainnet-mobile.mjs');
await import('./contributions-encounters-mobile.mjs');
