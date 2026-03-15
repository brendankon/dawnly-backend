require('dotenv').config();

const { runFetchAndScore } = require('./scheduler');

async function main() {
  const start = Date.now();
  console.log('[scheduler-once] Starting single run...');

  await runFetchAndScore();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[scheduler-once] Finished in ${elapsed}s`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[scheduler-once] Fatal error:', err.message);
  process.exit(1);
});
