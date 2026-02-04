const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { checkPage, computeDiff, checkKeywords } = require('./checker');
const { notifyChange, notifyWebhook, notifySlack } = require('./notifier');

const app = express();
const PORT = process.env.PORT || 3001;

// Simple in-memory rate limiter
const rateLimitStore = new Map();
function rateLimit(windowMs, maxRequests) {
  return (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;
    
    if (!rateLimitStore.has(key)) {
      rateLimitStore.set(key, []);
    }
    
    const requests = rateLimitStore.get(key).filter(t => t > windowStart);
    requests.push(now);
    rateLimitStore.set(key, requests);
    
    if (requests.length > maxRequests) {
      return res.status(429).json({ 
        error: 'rate_limit_exceeded',
        message: 'Too many requests. Please slow down.',
        retry_after: Math.ceil(windowMs / 1000)
      });
    }
    next();
  };
}

// Cleanup rate limit store every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 300000;
  for (const [key, times] of rateLimitStore.entries()) {
    const valid = times.filter(t => t > cutoff);
    if (valid.length === 0) rateLimitStore.delete(key);
    else rateLimitStore.set(key, valid);
  }
}, 300000);

app.use(express.json());

// CORS headers for API access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

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

// Rate limiters
const authLimiter = rateLimit(60000, 5);      // 5 requests per minute for auth
const apiLimiter = rateLimit(60000, 60);      // 60 requests per minute for API
const newsletterLimiter = rateLimit(3600000, 3); // 3 per hour for newsletter

// Public routes
app.post('/api/register', authLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  
  if (db.getUserByEmail(email)) return res.status(400).json({ error: 'Email already registered' });
  
  const user = db.createUser(email, password);
  res.json({ success: true, api_key: user.apiKey, plan: user.plan });
});

app.post('/api/login', authLimiter, (req, res) => {
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
  const { name, url, check_interval, selector, notify_webhook, webhook_type, keywords, keyword_mode } = req.body;
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
    notifyWebhook: notify_webhook,
    webhookType: webhook_type || 'standard', // 'standard' or 'slack'
    keywords: keywords || [], // Array of keywords to watch for
    keywordMode: keyword_mode || 'any' // 'any', 'all', 'appear', 'disappear'
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

// Get check history for a monitor
app.get('/api/monitors/:id/history', auth, (req, res) => {
  const monitor = db.getMonitor(req.params.id);
  if (!monitor || monitor.userId !== req.user.id) {
    return res.status(404).json({ error: 'Monitor not found' });
  }
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const checks = db.getChecksByMonitor(monitor.id, limit);
  
  const summary = {
    totalChecks: checks.length,
    changesDetected: checks.filter(c => c.changed).length,
    errors: checks.filter(c => c.error).length,
    lastCheck: monitor.lastCheck,
    lastChange: checks.find(c => c.changed)?.checkedAt || null
  };
  
  res.json({ monitor: { id: monitor.id, name: monitor.name, url: monitor.url }, summary, checks });
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

// Newsletter subscription
app.post('/api/newsletter', newsletterLimiter, (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  
  const sub = db.addNewsletterSubscriber(email.toLowerCase().trim());
  if (sub === null) {
    return res.json({ success: true, message: 'Already subscribed!' });
  }
  
  console.log(`[NEWSLETTER] New subscriber: ${email}`);
  res.json({ success: true });
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
    
    // Compute diff if changed
    let diff = null;
    if (changed && monitor.lastContent) {
      diff = computeDiff(monitor.lastContent, result.content);
      console.log(`  📝 Diff: ${diff?.summary || 'computed'}`);
    }
    
    // Store check with content and diff
    db.addCheck(monitor.id, { 
      hash: result.hash, 
      changed, 
      error: null,
      content: result.content,
      diff: diff
    });
    
    db.updateMonitor(monitor.id, {
      lastCheck: new Date().toISOString(),
      lastHash: result.hash,
      lastContent: result.content
    });
    
    if (changed) {
      console.log(`  🔔 CHANGE DETECTED!`);
      
      // Check keyword filters
      const keywordResult = checkKeywords(
        monitor.lastContent, 
        result.content, 
        monitor.keywords, 
        monitor.keywordMode
      );
      
      if (!keywordResult.shouldNotify && monitor.keywords?.length > 0) {
        console.log(`  ⏭️ Skipped notification: ${keywordResult.reason}`);
      } else {
        // Add keyword info to diff
        if (keywordResult.matchedKeywords?.length > 0 && diff) {
          diff.keywordMatch = keywordResult.reason;
        }
        
        // Send email notification
        const user = db.getUserById(monitor.userId);
        if (user && monitor.notifyEmail !== false) {
          notifyChange(monitor, user, diff).catch(err => {
            console.error(`  ❌ Email failed: ${err.message}`);
          });
        }
        
        // Send webhook notification with diff
        if (monitor.notifyWebhook) {
          const webhookFn = monitor.webhookType === 'slack' ? notifySlack : notifyWebhook;
          webhookFn(monitor, monitor.notifyWebhook, diff).catch(err => {
            console.error(`  ❌ Webhook failed: ${err.message}`);
          });
        }
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
