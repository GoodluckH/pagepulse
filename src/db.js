const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Use DATA_DIR env var for Railway volume, fallback to local data folder
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

console.log(`📁 Database path: ${DB_PATH}`);

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      // Ensure newsletter array exists
      if (!data.newsletter) data.newsletter = [];
      return data;
    }
  } catch (e) {
    console.error('DB load error:', e);
  }
  return { users: {}, monitors: {}, checks: [], newsletter: [] };
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Simple in-memory DB with file persistence
class DB {
  constructor() {
    this.data = loadDB();
  }

  save() {
    saveDB(this.data);
  }

  // Users
  createUser(email, password) {
    const id = crypto.randomUUID();
    const apiKey = 'pp_' + crypto.randomBytes(24).toString('hex');
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    
    this.data.users[id] = {
      id,
      email,
      passwordHash,
      apiKey,
      plan: 'free',
      createdAt: new Date().toISOString()
    };
    this.save();
    return this.data.users[id];
  }

  getUserByEmail(email) {
    return Object.values(this.data.users).find(u => u.email === email);
  }

  getUserByApiKey(apiKey) {
    return Object.values(this.data.users).find(u => u.apiKey === apiKey);
  }

  getUserById(id) {
    return this.data.users[id];
  }

  getUserById(id) {
    return this.data.users[id];
  }

  // Monitors
  createMonitor(userId, { name, url, checkInterval, selector, notifyWebhook }) {
    const id = crypto.randomUUID();
    this.data.monitors[id] = {
      id,
      userId,
      name,
      url,
      checkInterval: checkInterval || 86400,
      selector,
      notifyWebhook,
      notifyEmail: true,
      status: 'active',
      lastCheck: null,
      lastHash: null,
      createdAt: new Date().toISOString()
    };
    this.save();
    return this.data.monitors[id];
  }

  getMonitorsByUser(userId) {
    return Object.values(this.data.monitors).filter(m => m.userId === userId);
  }

  getMonitor(id) {
    return this.data.monitors[id];
  }

  updateMonitor(id, updates) {
    if (this.data.monitors[id]) {
      Object.assign(this.data.monitors[id], updates);
      this.save();
    }
    return this.data.monitors[id];
  }

  deleteMonitor(id) {
    delete this.data.monitors[id];
    this.save();
  }

  getDueMonitors() {
    const now = Date.now();
    return Object.values(this.data.monitors).filter(m => {
      if (m.status !== 'active') return false;
      if (!m.lastCheck) return true;
      const lastCheckTime = new Date(m.lastCheck).getTime();
      return (now - lastCheckTime) >= (m.checkInterval * 1000);
    });
  }

  // Checks
  addCheck(monitorId, { hash, changed, error }) {
    const check = {
      id: crypto.randomUUID(),
      monitorId,
      hash,
      changed,
      error,
      checkedAt: new Date().toISOString()
    };
    this.data.checks.push(check);
    // Keep only last 1000 checks
    if (this.data.checks.length > 1000) {
      this.data.checks = this.data.checks.slice(-1000);
    }
    this.save();
    return check;
  }

  getChecksByMonitor(monitorId, limit = 50) {
    return this.data.checks
      .filter(c => c.monitorId === monitorId)
      .slice(-limit)
      .reverse();
  }

  // Newsletter
  addNewsletterSubscriber(email) {
    if (!this.data.newsletter) this.data.newsletter = [];
    if (this.data.newsletter.some(s => s.email === email)) {
      return null; // Already subscribed
    }
    const sub = {
      email,
      subscribedAt: new Date().toISOString()
    };
    this.data.newsletter.push(sub);
    this.save();
    return sub;
  }

  getNewsletterSubscribers() {
    return this.data.newsletter || [];
  }

  // Stats
  getStats() {
    return {
      users: Object.keys(this.data.users).length,
      monitors: Object.keys(this.data.monitors).length,
      checks: this.data.checks.length,
      newsletter: (this.data.newsletter || []).length
    };
  }
}

module.exports = new DB();
