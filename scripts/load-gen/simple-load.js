#!/usr/bin/env node
/**
 * Simple Node.js Load Generator
 * No dependencies required — uses built-in https module
 *
 * Usage:
 *   node scripts/load-gen/simple-load.js [options]
 *
 * Options (env vars):
 *   SCENARIO1_URL     URL for Scenario 1
 *   SCENARIO2_URL     URL for Scenario 2
 *   SCENARIO3_CHECKOUT_URL
 *   SCENARIO3_LOYALTY_URL
 *   SCENARIO4_FRONTEND_URL
 *   SCENARIO5_URL
 *   CONCURRENCY       Number of parallel requests (default: 5)
 *   DURATION_SEC      Duration in seconds (default: 60)
 *   REQUEST_INTERVAL  Ms between request batches (default: 500)
 */

const https = require('https');
const http = require('http');

// ===========================
// Configuration
// ===========================
const TARGETS = {
  scenario1: {
    base: process.env.SCENARIO1_URL || 'https://zr-safe-checkout.azurewebsites.net',
    label: 'Scenario1-Safe',
  },
  scenario2: {
    base: process.env.SCENARIO2_URL || 'https://zr-risky-checkout.azurewebsites.net',
    label: 'Scenario2-Hardcoded',
  },
  scenario3_checkout: {
    base: process.env.SCENARIO3_CHECKOUT_URL || 'https://zr-shared-checkout.azurewebsites.net',
    label: 'Scenario3-Checkout',
  },
  scenario3_loyalty: {
    base: process.env.SCENARIO3_LOYALTY_URL || 'https://zr-shared-loyalty.azurewebsites.net',
    label: 'Scenario3-Loyalty',
  },
  scenario4: {
    base: process.env.SCENARIO4_FRONTEND_URL || 'http://localhost:8080',
    label: 'Scenario4-AKS',
  },
  scenario5: {
    base: process.env.SCENARIO5_URL || 'https://zr-replace-checkout.azurewebsites.net',
    label: 'Scenario5-Replacement',
  },
};

const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5');
const DURATION_SEC = parseInt(process.env.DURATION_SEC || '60');
const REQUEST_INTERVAL = parseInt(process.env.REQUEST_INTERVAL || '500');

// ===========================
// Stats tracking
// ===========================
const stats = {};
Object.values(TARGETS).forEach(t => {
  stats[t.label] = { success: 0, error: 0, total: 0, totalDuration: 0 };
});

// ===========================
// HTTP helper
// ===========================
function makeRequest(url, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ZR-Demo-LoadGen/1.0',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
      // Allow self-signed certs in demo environments
      rejectUnauthorized: false,
      timeout: 10000,
    };

    const start = Date.now();
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, duration: Date.now() - start, data });
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

    if (body) req.write(body);
    req.end();
  });
}

// ===========================
// Scenario request patterns
// ===========================
function randomId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

const SCENARIOS = [
  // Scenario 1: Safe checkout
  async () => {
    const { base, label } = TARGETS.scenario1;
    await makeRequest(`${base}/health`).then(r => trackResult(label, r));
    await makeRequest(
      `${base}/checkout`, 'POST',
      JSON.stringify({ orderId: randomId('order'), items: [{ productId: 1, qty: 2 }] })
    ).then(r => trackResult(label, r));
  },
  // Scenario 2: Risky checkout (hard-coded)
  async () => {
    const { base, label } = TARGETS.scenario2;
    await makeRequest(`${base}/health`).then(r => trackResult(label, r));
    await makeRequest(
      `${base}/checkout`, 'POST',
      JSON.stringify({ orderId: randomId('order'), items: [{ productId: 1, qty: 1 }] })
    ).then(r => trackResult(label, r));
  },
  // Scenario 3: Checkout + loyalty (shared infra)
  async () => {
    const checkout = TARGETS.scenario3_checkout;
    const loyalty = TARGETS.scenario3_loyalty;
    await makeRequest(`${checkout.base}/health`).then(r => trackResult(checkout.label, r));
    await makeRequest(
      `${checkout.base}/checkout`, 'POST',
      JSON.stringify({ orderId: randomId('order'), items: [{ productId: 2, qty: 1 }] })
    ).then(r => trackResult(checkout.label, r));
    await makeRequest(
      `${loyalty.base}/loyalty`, 'POST',
      JSON.stringify({ customerId: randomId('cust'), points: Math.floor(Math.random() * 100) + 10 })
    ).then(r => trackResult(loyalty.label, r));
  },
  // Scenario 4: AKS frontend
  async () => {
    const { base, label } = TARGETS.scenario4;
    await makeRequest(`${base}/health`).then(r => trackResult(label, r));
    await makeRequest(`${base}/products`).then(r => trackResult(label, r));
    await makeRequest(
      `${base}/checkout`, 'POST',
      JSON.stringify({ customerId: randomId('cust'), productId: 1, quantity: 1 })
    ).then(r => trackResult(label, r));
  },
  // Scenario 5: Replacement
  async () => {
    const { base, label } = TARGETS.scenario5;
    await makeRequest(`${base}/health`).then(r => trackResult(label, r));
    await makeRequest(`${base}/migration-status`).then(r => trackResult(label, r));
    await makeRequest(
      `${base}/checkout`, 'POST',
      JSON.stringify({ orderId: randomId('order'), items: [{ productId: 3, qty: 1 }] })
    ).then(r => trackResult(label, r));
  },
];

function trackResult(label, result) {
  if (!stats[label]) return;
  stats[label].total++;
  stats[label].totalDuration += result.duration;
  if (result.status >= 200 && result.status < 300) {
    stats[label].success++;
  } else {
    stats[label].error++;
  }
}

// ===========================
// Main loop
// ===========================
async function runBatch() {
  const promises = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    const scenarioFn = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
    promises.push(scenarioFn().catch(err => {
      // Silently count errors — don't crash the loop
    }));
  }
  await Promise.allSettled(promises);
}

function printStats() {
  console.clear();
  console.log(`\n=== ZR Demo Load Generator — ${new Date().toISOString()} ===\n`);
  console.log(`Concurrency: ${CONCURRENCY} | Interval: ${REQUEST_INTERVAL}ms | Duration: ${DURATION_SEC}s\n`);
  console.log('Target'.padEnd(28) + 'Total'.padStart(8) + '  Success'.padStart(10) + '  Errors'.padStart(10) + '  Avg(ms)'.padStart(10));
  console.log('-'.repeat(70));
  for (const [label, s] of Object.entries(stats)) {
    const avg = s.total > 0 ? Math.round(s.totalDuration / s.total) : 0;
    const errPct = s.total > 0 ? ((s.error / s.total) * 100).toFixed(1) : '0.0';
    const errStr = s.error > 0 ? `${s.error} (${errPct}%)` : '0';
    console.log(
      label.padEnd(28) +
      String(s.total).padStart(8) +
      String(s.success).padStart(10) +
      errStr.padStart(10) +
      String(avg).padStart(10)
    );
  }
  console.log('\n(Press Ctrl+C to stop)\n');
}

async function main() {
  console.log(`Starting load generator for ${DURATION_SEC}s...`);
  console.log('Configure targets with environment variables (SCENARIO1_URL, SCENARIO2_URL, etc.)\n');

  const endTime = Date.now() + DURATION_SEC * 1000;

  // Print stats every 5 seconds
  const statsInterval = setInterval(printStats, 5000);

  while (Date.now() < endTime) {
    await runBatch();
    await new Promise(r => setTimeout(r, REQUEST_INTERVAL));
  }

  clearInterval(statsInterval);
  printStats();
  console.log('\nLoad generation complete.');
}

main().catch(err => {
  console.error('Load generator error:', err);
  process.exit(1);
});
