const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { checkPage } = require('./checker');
const { sendNotification } = require('./notifier');
const { notifyChange, notifyWebhook } = require('./notifier');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Plan limits
const LIMITS = {
  free: { monitors: 3, minInterval: 86400 },
  pro: { monitors: 25, minInterval: 3600 },
  team: { monitors: 100, minInterval: 300 }
};

// Auth middleware
function auth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return res.status(401).json({ error: 'API key required' });
  
  const user = db.getUserByApiKey(apiKey);
  if (!user) return res.status(401).json({ error: 'Invalid API key' });
  
  req.user = user;
  next();
}

// Public routes
app.post('/api/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  
  if (db.getUserByEmail(email)) return res.status(400).json({ error: 'Email already registered' });
  
  const user = db.createUser(email, password);
  res.json({ success: true, api_key: user.apiKey, plan: user.plan });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.getUserByEmail(email);
  
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (user.passwordHash !== hash) return res.status(401).json({ error: 'Invalid credentials' });
  
  res.json({ success: true, api_key: user.apiKey, plan: user.plan });
});

// Protected routes
app.get('/api/monitors', auth, (req, res) => {
  const monitors = db.getMonitorsByUser(req.user.id);
  res.json({ monitors });
});

app.post('/api/monitors', auth, (req, res) => {
  const { name, url, check_interval, selector, notify_webhook } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL required' });
  
  const limits = LIMITS[req.user.plan] || LIMITS.free;
  const current = db.getMonitorsByUser(req.user.id).length;
  
  if (current >= limits.monitors) {
    return res.status(403).json({ error: `Plan limit: ${limits.monitors} monitors. Upgrade for more.` });
  }
  
  const interval = Math.max(check_interval || 86400, limits.minInterval);
  const monitor = db.createMonitor(req.user.id, {
    name,
    url,
    checkInterval: interval,
    selector,
    notifyWebhook: notify_webhook
  });
  
  res.json({ success: true, monitor });
});

app.get('/api/monitors/:id', auth, (req, res) => {
  const monitor = db.getMonitor(req.params.id);
  if (!monitor || monitor.userId !== req.user.id) {
    return res.status(404).json({ error: 'Monitor not found' });
  }
  const checks = db.getChecksByMonitor(monitor.id);
  res.json({ monitor, checks });
});

app.delete('/api/monitors/:id', auth, (req, res) => {
  const monitor = db.getMonitor(req.params.id);
  if (!monitor || monitor.userId !== req.user.id) {
    return res.status(404).json({ error: 'Monitor not found' });
  }
  db.deleteMonitor(req.params.id);
  res.json({ success: true });
});

// Manual check endpoint
app.post('/api/monitors/:id/check', auth, async (req, res) => {
  const monitor = db.getMonitor(req.params.id);
  if (!monitor || monitor.userId !== req.user.id) {
    return res.status(404).json({ error: 'Monitor not found' });
  }
  
  console.log(`[MANUAL CHECK] ${monitor.name} (${monitor.url})`);
  const result = await checkPage(monitor.url, monitor.selector);
  
  if (!result.success) {
    db.addCheck(monitor.id, { error: result.error, changed: false });
    db.updateMonitor(monitor.id, { lastCheck: new Date().toISOString() });
    return res.json({ success: false, error: result.error });
  }
  
  const changed = monitor.lastHash && monitor.lastHash !== result.hash;
  db.addCheck(monitor.id, { hash: result.hash, changed, error: null });
  db.updateMonitor(monitor.id, {
    lastCheck: new Date().toISOString(),
    lastHash: result.hash
  });
  
  res.json({ 
    success: true, 
    changed,
    hash: result.hash.substring(0, 16) + '...',
    checkedAt: new Date().toISOString()
  });
});

app.get('/api/account', auth, (req, res) => {
  const monitors = db.getMonitorsByUser(req.user.id);
  res.json({
    email: req.user.email,
    plan: req.user.plan,
    monitors: monitors.length,
    limits: LIMITS[req.user.plan] || LIMITS.free
  });
});

// Health & stats
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/stats', (req, res) => res.json(db.getStats()));

// Scheduler - runs every minute
async function runScheduler() {
  const due = db.getDueMonitors();
  
  for (const monitor of due) {
    console.log(`[CHECK] ${monitor.name} (${monitor.url})`);
    
    const result = await checkPage(monitor.url, monitor.selector);
    
    if (!result.success) {
      db.addCheck(monitor.id, { error: result.error, changed: false });
      db.updateMonitor(monitor.id, { lastCheck: new Date().toISOString() });
      console.log(`  ❌ Error: ${result.error}`);
      continue;
    }
    
    const changed = monitor.lastHash && monitor.lastHash !== result.hash;
    db.addCheck(monitor.id, { hash: result.hash, changed, error: null });
    db.updateMonitor(monitor.id, {
      lastCheck: new Date().toISOString(),
      lastHash: result.hash
    });
    
    if (changed) {
      console.log(`  🔔 CHANGE DETECTED!`);
      // Send notifications
      const user = db.getUserById(monitor.userId);
      if (user) {
        sendNotification(monitor, user, {
          checkedAt: new Date().toISOString(),
          hash: result.hash
        });
      }
    } else {
      console.log(`  ✓ No change`);
    }
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 PagePulse running on http://localhost:${PORT}`);
  console.log(`📊 Stats:`, db.getStats());
  
  // Run scheduler every 60 seconds
  setInterval(runScheduler, 60000);
  runScheduler(); // Run immediately on start
});
