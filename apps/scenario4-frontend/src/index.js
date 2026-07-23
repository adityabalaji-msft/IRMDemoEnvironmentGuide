// =============================================================================
// Scenario 4: AKS Frontend Service
// =============================================================================
// - Calls the backend API via K8s internal service DNS (backend-service.default.svc.cluster.local)
// - Reads assets from Azure Storage (URL from ConfigMap)
//
// 🎯 SIGNALS:
//    BACKEND_URL = K8s internal service name — requires K8s service discovery insight
//    STORAGE_ACCOUNT_URL = External Azure resource — requires ConfigMap inspection
//    Both are invisible from AKS cluster-level control plane analysis alone
// =============================================================================

require('dotenv').config();
const appInsights = require('applicationinsights');

appInsights
  .setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
  .setAutoCollectRequests(true)
  .setAutoCollectDependencies(true)  // Tracks HTTP calls to backend + Storage
  .setAutoCollectExceptions(true)
  .setSendLiveMetrics(true)
  .start();

const express = require('express');
const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const SCENARIO = 'scenario4-aks-frontend';

// --- Zone Discovery via K8s API ---
const fs = require('fs');
const https = require('https');
let podZone = 'unknown';
let k8sToken = '';
let k8sAgent = null;

function readK8sToken() {
  try {
    k8sToken = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
    const ca = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
    k8sAgent = new https.Agent({ ca });
  } catch { /* running outside cluster */ }
}

function k8sApi(path) {
  return new Promise((resolve) => {
    // Re-read token on each call (handles projected token rotation)
    let token, agent;
    try {
      token = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
      const ca = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
      agent = new https.Agent({ ca });
    } catch {
      resolve(null); return;
    }
    const req = https.get(`https://kubernetes.default.svc${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      agent,
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.warn(`[k8sApi] ${path} returned ${res.statusCode}: ${data.substring(0, 200)}`);
          resolve(null);
          return;
        }
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', (e) => { console.warn(`[k8sApi] ${path} error: ${e.message}`); resolve(null); });
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function discoverZone() {
  try {
    readK8sToken();
    const nodeName = process.env.NODE_NAME;
    if (!nodeName || !k8sToken) return;
    const node = await k8sApi(`/api/v1/nodes/${nodeName}`);
    if (node) {
      podZone = node.metadata?.labels?.['topology.kubernetes.io/zone'] || 'unknown';
      console.log(`[zone-discovery] Node ${nodeName} is in zone: ${podZone}`);
    }
  } catch (err) {
    console.warn(`[zone-discovery] Could not determine zone: ${err.message}`);
  }
}
discoverZone();

// K8s internal service name — set via ConfigMap
// e.g. http://backend-service.default.svc.cluster.local:8080
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend-service:8080';
const STORAGE_URL = process.env.STORAGE_ACCOUNT_URL;
const STORAGE_ACCOUNT_NAME = process.env.STORAGE_ACCOUNT_NAME;
const STORAGE_ACCOUNT_KEY = process.env.STORAGE_ACCOUNT_KEY;

// Build authenticated storage client using account key
let storageClient = null;
if (STORAGE_URL && STORAGE_ACCOUNT_NAME && STORAGE_ACCOUNT_KEY) {
  const sharedKeyCred = new StorageSharedKeyCredential(STORAGE_ACCOUNT_NAME, STORAGE_ACCOUNT_KEY);
  storageClient = new BlobServiceClient(STORAGE_URL, sharedKeyCred);
} else if (STORAGE_URL) {
  storageClient = new BlobServiceClient(STORAGE_URL);
}

// --- HTML Landing Page: E-Commerce App ---
app.get('/', async (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZoneReady Shop — Cloud-Native E-Commerce</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #1a1a2e; min-height: 100vh; }

    /* Navigation */
    .navbar { background: #1a1a2e; padding: 0 2rem; height: 64px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    .nav-brand { display: flex; align-items: center; gap: 0.75rem; }
    .nav-brand h1 { color: #fff; font-size: 1.3rem; font-weight: 700; }
    .nav-brand .logo { width: 32px; height: 32px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; }
    .nav-links { display: flex; gap: 1.5rem; align-items: center; }
    .nav-links a { color: #b8c0cc; text-decoration: none; font-size: 0.9rem; transition: color 0.2s; }
    .nav-links a:hover { color: #fff; }
    .nav-links a.active { color: #667eea; font-weight: 600; }
    .cart-btn { background: #667eea; color: #fff; border: none; padding: 8px 16px; border-radius: 20px; cursor: pointer; font-size: 0.85rem; display: flex; align-items: center; gap: 6px; transition: background 0.2s; }
    .cart-btn:hover { background: #5a6fd6; }
    .cart-count { background: #ff4757; color: #fff; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; }
    .infra-btn { background: transparent; color: #8b949e; border: 1px solid #30363d; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; transition: all 0.2s; }
    .infra-btn:hover { border-color: #667eea; color: #667eea; }

    /* Hero Banner */
    .hero { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); padding: 3rem 2rem; text-align: center; color: #fff; }
    .hero h2 { font-size: 2.2rem; margin-bottom: 0.5rem; }
    .hero p { color: #b8c0cc; font-size: 1.1rem; max-width: 600px; margin: 0 auto; }
    .hero-badges { display: flex; gap: 1rem; justify-content: center; margin-top: 1.5rem; flex-wrap: wrap; }
    .hero-badge { background: rgba(102,126,234,0.15); border: 1px solid rgba(102,126,234,0.3); padding: 6px 14px; border-radius: 20px; font-size: 0.8rem; color: #a5b4fc; }

    /* Status Bar */
    .status-bar { background: #fff; border-bottom: 1px solid #e2e8f0; padding: 0.5rem 2rem; display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; }
    .status-bar .status-left { display: flex; gap: 1.5rem; align-items: center; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
    .status-dot.green { background: #10b981; }
    .status-dot.red { background: #ef4444; animation: pulse 1.5s infinite; }
    .status-bar .zone-tag { background: #eef2ff; color: #4338ca; padding: 2px 10px; border-radius: 12px; font-weight: 500; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

    /* Main Content */
    .main { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .section-header h2 { font-size: 1.5rem; color: #1a1a2e; }
    .section-header .filter-pills { display: flex; gap: 0.5rem; }
    .pill { padding: 6px 14px; border-radius: 20px; border: 1px solid #e2e8f0; background: #fff; cursor: pointer; font-size: 0.8rem; transition: all 0.2s; }
    .pill.active { background: #667eea; color: #fff; border-color: #667eea; }
    .pill:hover:not(.active) { border-color: #667eea; color: #667eea; }

    /* Product Grid */
    .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 1.5rem; margin-bottom: 3rem; }
    .product-card { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06); transition: all 0.3s; border: 1px solid #e2e8f0; }
    .product-card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
    .product-img { width: 100%; height: 200px; object-fit: cover; background: linear-gradient(135deg, #667eea22, #764ba222); display: flex; align-items: center; justify-content: center; font-size: 3rem; }
    .product-body { padding: 1.2rem; }
    .product-category { font-size: 0.75rem; color: #667eea; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.4rem; }
    .product-name { font-size: 1rem; font-weight: 600; margin-bottom: 0.4rem; color: #1a1a2e; }
    .product-desc { font-size: 0.85rem; color: #64748b; margin-bottom: 1rem; line-height: 1.4; }
    .product-footer { display: flex; justify-content: space-between; align-items: center; }
    .product-price { font-size: 1.2rem; font-weight: 700; color: #1a1a2e; }
    .product-price .orig { text-decoration: line-through; color: #94a3b8; font-size: 0.85rem; font-weight: 400; margin-left: 6px; }
    .add-btn { background: #667eea; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 500; transition: background 0.2s; }
    .add-btn:hover { background: #5a6fd6; }
    .add-btn:active { transform: scale(0.95); }
    .add-btn.added { background: #10b981; }

    /* Orders Section */
    .orders-section { background: #fff; border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .order-row { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9; }
    .order-row:last-child { border-bottom: none; }
    .order-id { font-family: monospace; font-size: 0.85rem; color: #667eea; }
    .order-status { padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
    .order-status.confirmed { background: #dcfce7; color: #166534; }
    .order-status.processing { background: #fef3c7; color: #92400e; }
    .order-status.shipped { background: #dbeafe; color: #1e40af; }

    /* Cart Drawer */
    .cart-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 2000; display: none; }
    .cart-overlay.open { display: block; }
    .cart-drawer { position: fixed; top: 0; right: -420px; width: 420px; height: 100vh; background: #fff; z-index: 2001; transition: right 0.3s ease; box-shadow: -4px 0 24px rgba(0,0,0,0.2); display: flex; flex-direction: column; }
    .cart-drawer.open { right: 0; }
    .cart-header { padding: 1.5rem; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
    .cart-header h3 { font-size: 1.2rem; }
    .cart-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #64748b; }
    .cart-items { flex: 1; overflow-y: auto; padding: 1rem 1.5rem; }
    .cart-item { display: flex; gap: 1rem; padding: 1rem 0; border-bottom: 1px solid #f1f5f9; }
    .cart-item-img { width: 60px; height: 60px; border-radius: 8px; background: #f1f5f9; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; }
    .cart-item-info { flex: 1; }
    .cart-item-name { font-weight: 600; font-size: 0.9rem; }
    .cart-item-price { color: #667eea; font-weight: 600; margin-top: 4px; }
    .cart-item-remove { background: none; border: none; color: #ef4444; cursor: pointer; font-size: 0.8rem; }
    .cart-footer { padding: 1.5rem; border-top: 1px solid #e2e8f0; }
    .cart-total { display: flex; justify-content: space-between; font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; }
    .checkout-btn { width: 100%; background: #667eea; color: #fff; border: none; padding: 14px; border-radius: 10px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .checkout-btn:hover { background: #5a6fd6; }
    .checkout-btn:disabled { background: #94a3b8; cursor: not-allowed; }
    .cart-empty { text-align: center; color: #94a3b8; padding: 3rem 0; font-size: 0.95rem; }

    /* Toast */
    .toast { position: fixed; bottom: 2rem; right: 2rem; background: #1a1a2e; color: #fff; padding: 12px 20px; border-radius: 10px; font-size: 0.9rem; z-index: 3000; display: none; box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
    .toast.show { display: flex; align-items: center; gap: 8px; animation: slideUp 0.3s ease; }
    @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

    /* Infrastructure Panel */
    .infra-panel { display: none; position: fixed; top: 64px; left: 0; right: 0; bottom: 0; background: #0f1117; z-index: 1500; overflow-y: auto; padding: 2rem; color: #e1e4e8; }
    .infra-panel.open { display: block; }
    .infra-panel h2 { color: #58a6ff; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem; }
    .infra-close { position: absolute; top: 1rem; right: 2rem; background: none; border: 1px solid #30363d; color: #8b949e; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
    .infra-close:hover { border-color: #58a6ff; color: #58a6ff; }
    .infra-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .infra-card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 1.5rem; }
    .infra-card h4 { color: #58a6ff; margin-bottom: 0.75rem; font-size: 1rem; }
    .infra-card .dep-row { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #21262d; font-size: 0.85rem; }
    .infra-card .dep-row:last-child { border-bottom: none; }
    .infra-card .dep-label { color: #8b949e; }
    .infra-card .dep-value { color: #e1e4e8; font-family: monospace; font-size: 0.8rem; }
    .infra-card .dep-status { display: flex; align-items: center; gap: 4px; }
    .zone-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1rem; }
    .zone-card { border-radius: 10px; padding: 1.2rem; text-align: center; transition: all 0.3s ease; }
    .zone-card.healthy { background: #0d1f0d; border: 2px solid #238636; }
    .zone-card.degraded { background: #2d1f0a; border: 2px solid #d29922; }
    .zone-card.down { background: #2d0a0a; border: 2px solid #da3633; }
    .zone-card.empty { background: #161b22; border: 2px dashed #30363d; opacity: 0.5; }
    .zone-card h4 { font-size: 1rem; margin-bottom: 0.3rem; color: #e1e4e8; }
    .zone-card .zone-count { font-size: 1.8rem; font-weight: bold; }
    .zone-card .zone-label { font-size: 0.7rem; color: #8b949e; margin-top: 0.2rem; }
    .zone-card .zone-status-text { font-size: 0.75rem; margin-top: 0.4rem; font-weight: 600; }
    .pod-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 1rem; }
    .pod-table th { text-align: left; color: #8b949e; padding: 0.5rem; border-bottom: 1px solid #30363d; }
    .pod-table td { padding: 0.5rem; border-bottom: 1px solid #21262d; font-family: monospace; }
    .pod-table .ready { color: #3fb950; }
    .pod-table .not-ready { color: #f85149; }
    .serving-badge { display: inline-block; font-size: 0.65rem; padding: 2px 6px; border-radius: 8px; background: #1f6feb33; color: #58a6ff; margin-left: 4px; }
    .zone-event-log { background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 0.75rem; max-height: 140px; overflow-y: auto; font-family: monospace; font-size: 0.75rem; margin-top: 1rem; }
    .zone-event-log .event { padding: 2px 0; }
    .zone-event-log .event.warn { color: #d29922; }
    .zone-event-log .event.error { color: #f85149; }
    .zone-event-log .event.ok { color: #3fb950; }

    /* Footer */
    .footer { background: #1a1a2e; color: #8b949e; padding: 1.5rem 2rem; text-align: center; font-size: 0.8rem; margin-top: 2rem; }
    .footer a { color: #667eea; text-decoration: none; }
  </style>
</head>
<body>
  <!-- Navigation -->
  <nav class="navbar">
    <div class="nav-brand">
      <div class="logo">Z</div>
      <h1>ZoneReady Shop</h1>
    </div>
    <div class="nav-links">
      <a href="#" class="active" onclick="showStore()">Products</a>
      <a href="#orders-section" onclick="loadOrders()">Orders</a>
      <button class="infra-btn" onclick="toggleInfra()">&#9881; Infrastructure</button>
      <button class="cart-btn" onclick="openCart()">
        &#128722; Cart <span class="cart-count" id="cart-count">0</span>
      </button>
    </div>
  </nav>

  <!-- Status Bar -->
  <div class="status-bar" id="status-bar">
    <div class="status-left">
      <span><span class="status-dot green" id="backend-dot"></span> Backend API</span>
      <span><span class="status-dot green" id="storage-dot"></span> Blob Storage</span>
      <span><span class="status-dot green" id="sql-dot"></span> Azure SQL</span>
    </div>
    <span class="zone-tag" id="zone-tag">Zone: ${podZone}</span>
  </div>

  <!-- Hero -->
  <section class="hero">
    <h2>Cloud-Native E-Commerce</h2>
    <p>A zone-resilient microservices demo running on Azure Kubernetes Service with multi-AZ high availability</p>
    <div class="hero-badges">
      <span class="hero-badge">AKS Multi-Zone</span>
      <span class="hero-badge">Azure SQL</span>
      <span class="hero-badge">Blob Storage</span>
      <span class="hero-badge">Container Registry</span>
      <span class="hero-badge">App Insights</span>
    </div>
  </section>

  <!-- Main Content -->
  <main class="main">
    <div class="section-header">
      <h2>Product Catalog</h2>
      <div class="filter-pills">
        <span class="pill active" onclick="filterProducts('all', this)">All</span>
        <span class="pill" onclick="filterProducts('electronics', this)">Electronics</span>
        <span class="pill" onclick="filterProducts('clothing', this)">Clothing</span>
        <span class="pill" onclick="filterProducts('home', this)">Home & Garden</span>
      </div>
    </div>
    <div class="product-grid" id="product-grid">
      <!-- Products loaded via JS -->
      <div style="grid-column: 1/-1; text-align:center; padding:2rem; color:#94a3b8;">Loading products...</div>
    </div>

    <!-- Recent Orders -->
    <div class="section-header" style="margin-top:2rem;">
      <h2>Recent Orders</h2>
    </div>
    <div class="orders-section" id="orders-section">
      <div style="text-align:center; color:#94a3b8; padding:1rem;">Place an order to see it here</div>
    </div>
  </main>

  <!-- Cart Drawer -->
  <div class="cart-overlay" id="cart-overlay" onclick="closeCart()"></div>
  <div class="cart-drawer" id="cart-drawer">
    <div class="cart-header">
      <h3>Shopping Cart</h3>
      <button class="cart-close" onclick="closeCart()">&times;</button>
    </div>
    <div class="cart-items" id="cart-items">
      <div class="cart-empty">Your cart is empty</div>
    </div>
    <div class="cart-footer">
      <div class="cart-total"><span>Total</span><span id="cart-total">$0.00</span></div>
      <button class="checkout-btn" id="checkout-btn" onclick="doCheckout()" disabled>Place Order</button>
    </div>
  </div>

  <!-- Infrastructure Panel -->
  <div class="infra-panel" id="infra-panel">
    <button class="infra-close" onclick="toggleInfra()">&#10005; Close</button>
    <h2>&#9881; Infrastructure &amp; Zone Status</h2>

    <div class="infra-grid">
      <div class="infra-card">
        <h4>&#128279; Dependencies</h4>
        <div class="dep-row"><span class="dep-label">Backend API</span><span class="dep-value dep-status"><span class="status-dot green" id="infra-backend-dot"></span> ${BACKEND_URL}</span></div>
        <div class="dep-row"><span class="dep-label">Azure Blob Storage</span><span class="dep-value dep-status"><span class="status-dot green" id="infra-storage-dot"></span> ${STORAGE_URL || 'NOT SET'}</span></div>
        <div class="dep-row"><span class="dep-label">Container Registry</span><span class="dep-value">zrdemoacr2.azurecr.io</span></div>
        <div class="dep-row"><span class="dep-label">Config Source</span><span class="dep-value">ConfigMap: frontend-config</span></div>
      </div>
      <div class="infra-card">
        <h4>&#128187; This Instance</h4>
        <div class="dep-row"><span class="dep-label">Pod</span><span class="dep-value">${process.env.POD_NAME || 'unknown'}</span></div>
        <div class="dep-row"><span class="dep-label">Node</span><span class="dep-value">${process.env.NODE_NAME || 'unknown'}</span></div>
        <div class="dep-row"><span class="dep-label">Zone</span><span class="dep-value">${podZone}</span></div>
        <div class="dep-row"><span class="dep-label">Image</span><span class="dep-value">zrdemoacr2.azurecr.io/scenario4-frontend:latest</span></div>
      </div>
    </div>

    <h3 style="color:#58a6ff; margin-bottom:1rem;">Availability Zone Distribution <span style="font-size:0.75rem;color:#8b949e;font-weight:normal">(auto-refreshes every 5s)</span></h3>
    <div id="zone-data"><div style="text-align:center;color:#8b949e;padding:2rem;">Loading zone status...</div></div>
    <div class="zone-event-log" id="zone-log"></div>
  </div>

  <!-- Toast -->
  <div class="toast" id="toast"></div>

  <!-- Footer -->
  <div class="footer">
    <p>ZoneReady Shop &mdash; Served from <strong>${podZone}</strong> &middot; Pod ${process.env.POD_NAME || 'unknown'} &middot; <a href="/health">Health</a> &middot; <a href="/zone-status">Zone API</a> &middot; <a href="/dependencies">Dependencies</a></p>
  </div>

  <script>
    // --- Product Data (hardcoded catalog with images from blob storage) ---
    const catalog = [
      { id: 'PROD-001', name: 'Wireless Noise-Cancelling Headphones', category: 'electronics', price: 249.99, origPrice: 299.99, desc: 'Premium ANC with 30hr battery life', icon: '&#127911;' },
      { id: 'PROD-002', name: 'Smart Fitness Watch', category: 'electronics', price: 179.99, origPrice: null, desc: 'Heart rate, GPS, 7-day battery', icon: '&#9201;' },
      { id: 'PROD-003', name: 'Portable Bluetooth Speaker', category: 'electronics', price: 89.99, origPrice: 119.99, desc: 'Waterproof, 360° sound, 12hr playtime', icon: '&#128266;' },
      { id: 'PROD-004', name: 'Merino Wool Sweater', category: 'clothing', price: 129.99, origPrice: null, desc: 'Ultra-soft, breathable, all-season comfort', icon: '&#129509;' },
      { id: 'PROD-005', name: 'Running Performance Jacket', category: 'clothing', price: 159.99, origPrice: 199.99, desc: 'Windproof, reflective, moisture-wicking', icon: '&#129509;' },
      { id: 'PROD-006', name: 'Organic Cotton T-Shirt Pack', category: 'clothing', price: 49.99, origPrice: null, desc: 'Pack of 3, sustainable fabric, classic fit', icon: '&#128085;' },
      { id: 'PROD-007', name: 'Smart Indoor Herb Garden', category: 'home', price: 99.99, origPrice: 129.99, desc: 'LED grow light, auto-watering, 6 pods', icon: '&#127793;' },
      { id: 'PROD-008', name: 'Ergonomic Desk Lamp', category: 'home', price: 69.99, origPrice: null, desc: 'Adjustable color temperature, USB charging', icon: '&#128161;' },
    ];

    let cart = [];
    let orders = [];
    let currentFilter = 'all';

    // --- Render Products ---
    function renderProducts(filter) {
      const filtered = filter === 'all' ? catalog : catalog.filter(p => p.category === filter);
      const grid = document.getElementById('product-grid');
      grid.innerHTML = filtered.map(p => {
        const inCart = cart.find(c => c.id === p.id);
        return '<div class="product-card" data-category="' + p.category + '">' +
          '<div class="product-img">' + p.icon + '</div>' +
          '<div class="product-body">' +
          '<div class="product-category">' + p.category + '</div>' +
          '<div class="product-name">' + p.name + '</div>' +
          '<div class="product-desc">' + p.desc + '</div>' +
          '<div class="product-footer">' +
          '<span class="product-price">$' + p.price.toFixed(2) + (p.origPrice ? '<span class="orig">$' + p.origPrice.toFixed(2) + '</span>' : '') + '</span>' +
          '<button class="add-btn' + (inCart ? ' added' : '') + '" onclick="addToCart(\\''+p.id+'\\')"> ' + (inCart ? '&#10003; Added' : '+ Add to Cart') + '</button>' +
          '</div></div></div>';
      }).join('');
    }

    function filterProducts(cat, el) {
      currentFilter = cat;
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      el.classList.add('active');
      renderProducts(cat);
    }

    // --- Cart ---
    function addToCart(id) {
      const p = catalog.find(x => x.id === id);
      if (!p) return;
      const existing = cart.find(c => c.id === id);
      if (existing) { existing.qty++; } else { cart.push({ ...p, qty: 1 }); }
      updateCartUI();
      renderProducts(currentFilter);
      showToast('&#10003; ' + p.name + ' added to cart');
    }

    function removeFromCart(id) {
      cart = cart.filter(c => c.id !== id);
      updateCartUI();
      renderProducts(currentFilter);
    }

    function updateCartUI() {
      document.getElementById('cart-count').textContent = cart.reduce((s, c) => s + c.qty, 0);
      const itemsEl = document.getElementById('cart-items');
      if (cart.length === 0) {
        itemsEl.innerHTML = '<div class="cart-empty">Your cart is empty</div>';
        document.getElementById('cart-total').textContent = '$0.00';
        document.getElementById('checkout-btn').disabled = true;
        return;
      }
      document.getElementById('checkout-btn').disabled = false;
      const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
      document.getElementById('cart-total').textContent = '$' + total.toFixed(2);
      itemsEl.innerHTML = cart.map(c =>
        '<div class="cart-item">' +
        '<div class="cart-item-img">' + c.icon + '</div>' +
        '<div class="cart-item-info"><div class="cart-item-name">' + c.name + ' x' + c.qty + '</div><div class="cart-item-price">$' + (c.price * c.qty).toFixed(2) + '</div></div>' +
        '<button class="cart-item-remove" onclick="removeFromCart(\\''+c.id+'\\')">Remove</button>' +
        '</div>'
      ).join('');
    }

    function openCart() { document.getElementById('cart-overlay').classList.add('open'); document.getElementById('cart-drawer').classList.add('open'); }
    function closeCart() { document.getElementById('cart-overlay').classList.remove('open'); document.getElementById('cart-drawer').classList.remove('open'); }

    // --- Checkout ---
    async function doCheckout() {
      const btn = document.getElementById('checkout-btn');
      btn.disabled = true; btn.textContent = 'Processing...';
      try {
        const r = await fetch('/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: cart.map(c => ({ productId: c.id, name: c.name, qty: c.qty, price: c.price })), total: cart.reduce((s, c) => s + c.price * c.qty, 0) })
        });
        const data = await r.json();
        const orderId = data.orderId || ('ORD-' + Date.now().toString(36).toUpperCase());
        orders.unshift({ id: orderId, items: [...cart], total: cart.reduce((s, c) => s + c.price * c.qty, 0), status: 'confirmed', time: new Date() });
        cart = [];
        updateCartUI();
        renderProducts(currentFilter);
        renderOrders();
        closeCart();
        showToast('&#10003; Order ' + orderId + ' confirmed!');
      } catch (err) {
        showToast('&#10060; Checkout failed: ' + err.message);
      }
      btn.disabled = false; btn.textContent = 'Place Order';
    }

    // --- Orders ---
    function renderOrders() {
      const el = document.getElementById('orders-section');
      if (orders.length === 0) { el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:1rem;">Place an order to see it here</div>'; return; }
      el.innerHTML = orders.map(o =>
        '<div class="order-row">' +
        '<span class="order-id">' + o.id + '</span>' +
        '<span>' + o.items.map(i => i.name).join(', ').substring(0, 50) + '</span>' +
        '<span>$' + o.total.toFixed(2) + '</span>' +
        '<span class="order-status confirmed">' + o.status.toUpperCase() + '</span>' +
        '</div>'
      ).join('');
    }
    function loadOrders() { renderOrders(); }

    // --- Toast ---
    function showToast(msg) {
      const t = document.getElementById('toast');
      t.innerHTML = msg; t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 3000);
    }

    // --- Infrastructure Panel ---
    function toggleInfra() {
      document.getElementById('infra-panel').classList.toggle('open');
      if (document.getElementById('infra-panel').classList.contains('open')) refreshZoneStatus();
    }
    function showStore() { document.getElementById('infra-panel').classList.remove('open'); }

    // --- Health checks for status bar ---
    async function checkHealth() {
      try {
        const r = await fetch('/health');
        const d = await r.json();
        document.getElementById('backend-dot').className = 'status-dot green';
        document.getElementById('zone-tag').textContent = 'Zone: ' + d.zone;
      } catch {
        document.getElementById('backend-dot').className = 'status-dot red';
      }
      try {
        const r = await fetch('/assets');
        const d = await r.json();
        document.getElementById('storage-dot').className = d.error ? 'status-dot red' : 'status-dot green';
      } catch {
        document.getElementById('storage-dot').className = 'status-dot red';
      }
    }

    // --- Zone Status (Infrastructure Panel) ---
    const allZones = ['westus2-1', 'westus2-2', 'westus2-3'];
    let previousZones = {};
    const eventLog = [];

    function addEvent(msg, level) {
      const ts = new Date().toLocaleTimeString();
      eventLog.unshift({ ts, msg, level });
      if (eventLog.length > 50) eventLog.pop();
      renderLog();
    }

    function renderLog() {
      const el = document.getElementById('zone-log');
      if (!el) return;
      el.innerHTML = eventLog.map(e =>
        '<div class="event ' + e.level + '">[' + e.ts + '] ' + e.msg + '</div>'
      ).join('');
    }

    async function refreshZoneStatus() {
      try {
        const r = await fetch('/zone-status');
        const data = await r.json();
        if (data.error) { document.getElementById('zone-data').innerHTML = '<div style="text-align:center;color:#8b949e;padding:2rem;">&#9888; ' + data.error + '</div>'; return; }

        // Detect zone changes
        for (const z of allZones) {
          const cur = data.zoneSummary[z];
          const prev = previousZones[z];
          if (prev && cur && prev.ready > 0 && cur.ready === 0) addEvent('Zone ' + z + ' lost all ready pods!', 'error');
          else if (prev && cur && prev.ready === 0 && cur.ready > 0) addEvent('Zone ' + z + ' recovered', 'ok');
          else if (!prev && cur && cur.ready > 0) addEvent('Zone ' + z + ' now has ' + cur.ready + ' pod(s)', 'ok');
          else if (prev && !cur) addEvent('Zone ' + z + ' drained', 'warn');
        }
        previousZones = JSON.parse(JSON.stringify(data.zoneSummary));

        let html = '<div class="zone-grid">';
        for (const z of allZones) {
          const info = data.zoneSummary[z];
          let cls = 'empty', statusText = 'No pods', icon = '&#11036;';
          if (info) {
            if (info.nodeUnschedulable) { cls = 'down'; statusText = 'CORDONED'; icon = '&#128308;'; }
            else if (info.ready === info.total && info.total > 0) { cls = 'healthy'; statusText = 'HEALTHY'; icon = '&#128994;'; }
            else if (info.ready > 0) { cls = 'degraded'; statusText = 'DEGRADED'; icon = '&#128993;'; }
            else { cls = 'down'; statusText = 'DOWN'; icon = '&#128308;'; }
          }
          html += '<div class="zone-card ' + cls + '"><h4>' + z.replace('westus2-', 'Zone ') + '</h4>';
          html += '<div class="zone-count">' + icon + ' ' + (info ? info.ready + '/' + info.total : '0') + '</div>';
          html += '<div class="zone-label">ready / total pods</div>';
          html += '<div class="zone-status-text">' + statusText + '</div></div>';
        }
        html += '</div>';

        html += '<table class="pod-table"><thead><tr><th>Service</th><th>Pod</th><th>Zone</th><th>Node</th><th>Status</th></tr></thead><tbody>';
        const servingPod = data.thisInstance.pod;
        for (const svc of ['frontend', 'backend']) {
          for (const p of data[svc] || []) {
            const cls = p.ready ? 'ready' : 'not-ready';
            const status = p.ready ? '&#9679; Ready' : '&#10007; ' + p.phase;
            const serving = p.name === servingPod ? '<span class="serving-badge">this instance</span>' : '';
            html += '<tr><td>' + svc + '</td><td>' + p.name.substring(0, 28) + serving + '</td><td>' + (p.zone || '-') + '</td><td>' + (p.node || '-').replace('aks-','').substring(0,22) + '</td><td class="' + cls + '">' + status + '</td></tr>';
          }
        }
        html += '</tbody></table>';
        document.getElementById('zone-data').innerHTML = html;
      } catch (err) {
        document.getElementById('zone-data').innerHTML = '<div style="text-align:center;color:#8b949e;padding:2rem;">&#9888; ' + err.message + '</div>';
      }
    }

    // --- Init ---
    renderProducts('all');
    checkHealth();
    setInterval(checkHealth, 15000);
    setInterval(() => { if (document.getElementById('infra-panel').classList.contains('open')) refreshZoneStatus(); }, 5000);
  </script>
</body>
</html>`);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'frontend',
    scenario: SCENARIO,
    pod: process.env.POD_NAME || 'unknown',
    node: process.env.NODE_NAME || 'unknown',
    zone: podZone,
    timestamp: new Date().toISOString(),
    config: {
      backendUrl: BACKEND_URL,
      storageUrl: STORAGE_URL || 'NOT SET',
      configSource: 'kubernetes-configmap',
    },
  });
});

app.get('/products', async (req, res) => {
  try {
    // HTTP call to backend — App Insights tracks this as outbound HTTP dependency
    const response = await fetch(`${BACKEND_URL}/api/products`);
    if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    const data = await response.json();
    res.json({
      service: 'frontend',
      products: data.products,
      fetchedFrom: BACKEND_URL,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(502).json({
      error: 'Backend unavailable',
      backendUrl: BACKEND_URL,
      detail: err.message,
      hint: 'Check ConfigMap frontend-config for BACKEND_URL',
    });
  }
});

app.post('/checkout', async (req, res) => {
  const body = req.body || {};
  try {
    const response = await fetch(`${BACKEND_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    res.status(response.status).json({ service: 'frontend', ...data });
  } catch (err) {
    res.status(502).json({ error: 'Backend unavailable', detail: err.message });
  }
});

app.post('/loyalty', async (req, res) => {
  const body = req.body || {};
  try {
    const response = await fetch(`${BACKEND_URL}/api/loyalty`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    res.status(response.status).json({ service: 'frontend', ...data });
  } catch (err) {
    res.status(502).json({ error: 'Backend unavailable', detail: err.message });
  }
});

app.get('/assets', async (req, res) => {
  if (!storageClient) {
    return res.status(503).json({ error: 'STORAGE_ACCOUNT_URL/KEY not configured in ConfigMap' });
  }
  try {
    const containerClient = storageClient.getContainerClient('demo-data');
    const blobs = [];
    for await (const blob of containerClient.listBlobsFlat({ maxPageSize: 10 })) {
      blobs.push(blob.name);
    }
    res.json({ assets: blobs, storageUrl: STORAGE_URL, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message, storageUrl: STORAGE_URL });
  }
});

// --- Zone Status API: Full cluster zone visibility for drill dashboard ---
app.get('/zone-status', async (req, res) => {
  try {
    if (!k8sToken) {
      return res.status(503).json({ error: 'Not running in-cluster — K8s API unavailable' });
    }

    // Get all app pods (frontend + backend)
    const [frontendPods, backendPods, nodeList] = await Promise.all([
      k8sApi('/api/v1/namespaces/default/pods?labelSelector=app%3Dfrontend'),
      k8sApi('/api/v1/namespaces/default/pods?labelSelector=app%3Dbackend'),
      k8sApi('/api/v1/nodes'),
    ]);

    // Build node->zone map
    const nodeZoneMap = {};
    if (nodeList?.items) {
      for (const node of nodeList.items) {
        const name = node.metadata.name;
        const zone = node.metadata.labels?.['topology.kubernetes.io/zone'] || 'unknown';
        const ready = node.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';
        const unschedulable = node.spec?.unschedulable || false;
        const pool = node.metadata.labels?.['agentpool'] || 'unknown';
        nodeZoneMap[name] = { zone, ready, unschedulable, pool };
      }
    }

    function mapPods(podList) {
      if (!podList?.items) return [];
      return podList.items.map(p => {
        const nodeName = p.spec.nodeName || 'unassigned';
        const nodeInfo = nodeZoneMap[nodeName] || { zone: 'unknown', ready: false, unschedulable: false, pool: 'unknown' };
        return {
          name: p.metadata.name,
          phase: p.status.phase,
          ready: p.status.conditions?.find(c => c.type === 'Ready')?.status === 'True' || false,
          node: nodeName,
          zone: nodeInfo.zone,
          nodeReady: nodeInfo.ready,
          nodeUnschedulable: nodeInfo.unschedulable,
          startTime: p.status.startTime,
        };
      });
    }

    const frontend = mapPods(frontendPods);
    const backend = mapPods(backendPods);

    // Summarize zone distribution
    const allPods = [...frontend, ...backend];
    const zoneSummary = {};
    for (const pod of allPods) {
      if (!zoneSummary[pod.zone]) {
        zoneSummary[pod.zone] = { total: 0, ready: 0, notReady: 0, nodeUnschedulable: false };
      }
      zoneSummary[pod.zone].total++;
      if (pod.ready) zoneSummary[pod.zone].ready++;
      else zoneSummary[pod.zone].notReady++;
      if (pod.nodeUnschedulable) zoneSummary[pod.zone].nodeUnschedulable = true;
    }

    res.json({
      timestamp: new Date().toISOString(),
      thisInstance: {
        pod: process.env.POD_NAME || 'unknown',
        node: process.env.NODE_NAME || 'unknown',
        zone: podZone,
      },
      zoneSummary,
      frontend,
      backend,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/dependencies', (req, res) => {
  res.json({
    scenario: SCENARIO,
    service: 'frontend',
    riskLevel: 'MEDIUM',
    note: 'Internal K8s service (backend-service) + external Azure Storage — both invisible from AKS control plane',
    dependencies: [
      {
        type: 'KubernetesService',
        configSource: 'kubernetes_configmap',
        configMapName: 'frontend-config',
        envVar: 'BACKEND_URL',
        value: BACKEND_URL,
        hardCoded: false,
        internal: true,
        note: 'K8s internal service DNS — resolves only within cluster',
      },
      {
        type: 'AzureBlobStorage',
        configSource: 'kubernetes_configmap',
        configMapName: 'frontend-config',
        envVar: 'STORAGE_ACCOUNT_URL',
        value: STORAGE_URL || 'NOT SET',
        hardCoded: false,
        internal: false,
      },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`[${SCENARIO}] Frontend service listening on port ${PORT}`);
  console.log(`Backend URL:  ${BACKEND_URL}`);
  console.log(`Storage URL:  ${STORAGE_URL || 'NOT SET'}`);
});
