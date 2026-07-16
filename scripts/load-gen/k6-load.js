/**
 * k6 Load Test Script — Azure Zonal Resiliency Demo
 *
 * Usage:
 *   k6 run scripts/load-gen/k6-load.js
 *
 * With custom URLs:
 *   k6 run -e SCENARIO1_URL=https://myapp.azurewebsites.net \
 *           -e SCENARIO3_FRONTDOOR_URL=https://myafd.z01.azurefd.net \
 *           scripts/load-gen/k6-load.js
 *
 * Purpose:
 *   - Drive traffic to all scenario endpoints
 *   - Ensures App Insights dependency map gets populated
 *   - Simulates realistic checkout + loyalty request patterns
 */

import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Rate, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const checkoutCount = new Counter('checkouts_total');
const loyaltyCount = new Counter('loyalty_calls_total');

// Load test configuration
export const options = {
  stages: [
    { duration: '30s', target: 5 },   // Ramp up
    { duration: '2m', target: 10 },   // Sustained load — populates App Insights map
    { duration: '30s', target: 20 },  // Spike
    { duration: '1m', target: 10 },   // Sustained after spike
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.10'],   // 90% success rate
    http_req_duration: ['p(95)<3000'], // 95th percentile < 3s
    errors: ['rate<0.10'],
  },
};

// Target URLs — override with -e flags or set defaults here
const SCENARIO1_URL = __ENV.SCENARIO1_URL || 'https://zr-safe-checkout.azurewebsites.net';
const SCENARIO2_URL = __ENV.SCENARIO2_URL || 'https://zr-risky-checkout.azurewebsites.net';
const SCENARIO3_CHECKOUT_URL = __ENV.SCENARIO3_CHECKOUT_URL || 'https://zr-shared-checkout.azurewebsites.net';
const SCENARIO3_LOYALTY_URL = __ENV.SCENARIO3_LOYALTY_URL || 'https://zr-shared-loyalty.azurewebsites.net';
const SCENARIO3_FRONTDOOR_URL = __ENV.SCENARIO3_FRONTDOOR_URL || 'https://zr-shared-afd-endpoint.z01.azurefd.net';
const SCENARIO4_FRONTEND_URL = __ENV.SCENARIO4_FRONTEND_URL || 'http://REPLACE_WITH_AKS_EXTERNAL_IP';
const SCENARIO5_URL = __ENV.SCENARIO5_URL || 'https://zr-replace-checkout.azurewebsites.net';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function randomOrderId() {
  return `order-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function randomCustomerId() {
  return `cust-${Math.floor(Math.random() * 1000)}`;
}

function checkoutPayload(orderId) {
  return JSON.stringify({
    orderId,
    items: [
      { productId: Math.floor(Math.random() * 3) + 1, quantity: Math.floor(Math.random() * 3) + 1 },
      { productId: Math.floor(Math.random() * 3) + 1, quantity: 1 },
    ],
  });
}

// =============================================================================
// SCENARIO 1: Safe App — should always succeed, clean dependency map
// =============================================================================
function loadScenario1() {
  group('Scenario1-Safe', () => {
    // Health check
    const health = http.get(`${SCENARIO1_URL}/health`);
    check(health, { 'S1 health 200': (r) => r.status === 200 });
    errorRate.add(health.status !== 200);

    sleep(0.5);

    // Checkout POST
    const checkout = http.post(
      `${SCENARIO1_URL}/checkout`,
      checkoutPayload(randomOrderId()),
      { headers: JSON_HEADERS }
    );
    check(checkout, { 'S1 checkout 200': (r) => r.status === 200 });
    errorRate.add(checkout.status !== 200);
    checkoutCount.add(1);

    sleep(0.5);

    // Dependencies endpoint
    const deps = http.get(`${SCENARIO1_URL}/dependencies`);
    check(deps, { 'S1 dependencies 200': (r) => r.status === 200 });
  });
}

// =============================================================================
// SCENARIO 2: Risky App — may fail if hard-coded endpoints are stale
// =============================================================================
function loadScenario2() {
  group('Scenario2-Hardcoded', () => {
    const health = http.get(`${SCENARIO2_URL}/health`);
    check(health, { 'S2 health 200': (r) => r.status === 200 });
    errorRate.add(health.status !== 200);

    sleep(0.5);

    const checkout = http.post(
      `${SCENARIO2_URL}/checkout`,
      checkoutPayload(randomOrderId()),
      { headers: JSON_HEADERS }
    );
    check(checkout, { 'S2 checkout 200': (r) => r.status === 200 });
    errorRate.add(checkout.status !== 200);
    checkoutCount.add(1);
  });
}

// =============================================================================
// SCENARIO 3: Shared Infra — both services behind same Front Door
// =============================================================================
function loadScenario3() {
  group('Scenario3-SharedInfra', () => {
    // Hit via individual app URLs
    const checkoutHealth = http.get(`${SCENARIO3_CHECKOUT_URL}/health`);
    check(checkoutHealth, { 'S3 checkout health 200': (r) => r.status === 200 });

    const loyaltyHealth = http.get(`${SCENARIO3_LOYALTY_URL}/health`);
    check(loyaltyHealth, { 'S3 loyalty health 200': (r) => r.status === 200 });

    sleep(0.5);

    // Checkout via checkout app
    const checkout = http.post(
      `${SCENARIO3_CHECKOUT_URL}/checkout`,
      checkoutPayload(randomOrderId()),
      { headers: JSON_HEADERS }
    );
    check(checkout, { 'S3 checkout 200': (r) => r.status === 200 });
    checkoutCount.add(1);

    sleep(0.5);

    // Loyalty points via loyalty app
    const loyalty = http.post(
      `${SCENARIO3_LOYALTY_URL}/loyalty`,
      JSON.stringify({ customerId: randomCustomerId(), points: Math.floor(Math.random() * 100) + 10 }),
      { headers: JSON_HEADERS }
    );
    check(loyalty, { 'S3 loyalty 200': (r) => r.status === 200 });
    loyaltyCount.add(1);

    sleep(0.5);

    // Access via shared Front Door (demonstrates shared blast radius)
    const fdHealth = http.get(`${SCENARIO3_FRONTDOOR_URL}/health`);
    check(fdHealth, { 'S3 frontdoor health 200': (r) => r.status === 200 });
  });
}

// =============================================================================
// SCENARIO 4: AKS Workload
// =============================================================================
function loadScenario4() {
  group('Scenario4-AKS', () => {
    const health = http.get(`${SCENARIO4_FRONTEND_URL}/health`);
    check(health, { 'S4 frontend health 200': (r) => r.status === 200 });

    sleep(0.5);

    const products = http.get(`${SCENARIO4_FRONTEND_URL}/products`);
    check(products, { 'S4 products 200': (r) => r.status === 200 });

    sleep(0.5);

    const checkout = http.post(
      `${SCENARIO4_FRONTEND_URL}/checkout`,
      JSON.stringify({ customerId: randomCustomerId(), productId: 1, quantity: 2 }),
      { headers: JSON_HEADERS }
    );
    check(checkout, { 'S4 checkout 2xx': (r) => r.status >= 200 && r.status < 300 });
    checkoutCount.add(1);
  });
}

// =============================================================================
// SCENARIO 5: Replacement
// =============================================================================
function loadScenario5() {
  group('Scenario5-Replacement', () => {
    const health = http.get(`${SCENARIO5_URL}/health`);
    check(health, { 'S5 health 200': (r) => r.status === 200 });

    sleep(0.5);

    const status = http.get(`${SCENARIO5_URL}/migration-status`);
    check(status, { 'S5 migration-status 200': (r) => r.status === 200 });

    sleep(0.5);

    const checkout = http.post(
      `${SCENARIO5_URL}/checkout`,
      checkoutPayload(randomOrderId()),
      { headers: JSON_HEADERS }
    );
    check(checkout, { 'S5 checkout 200': (r) => r.status === 200 });
    checkoutCount.add(1);
  });
}

// =============================================================================
// MAIN — called once per virtual user iteration
// =============================================================================
export default function () {
  // Distribute load across scenarios
  const rnd = Math.random();

  if (rnd < 0.30) {
    loadScenario1();  // 30% to safe app
  } else if (rnd < 0.50) {
    loadScenario2();  // 20% to risky app
  } else if (rnd < 0.70) {
    loadScenario3();  // 20% to shared infra
  } else if (rnd < 0.85) {
    loadScenario4();  // 15% to AKS
  } else {
    loadScenario5();  // 15% to replacement
  }

  sleep(Math.random() * 2 + 1); // Random think time 1-3s
}
