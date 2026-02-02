const crypto = require('crypto');
const https = require('https');
const http = require('http');

async function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PagePulse/1.0; +https://pagepulse.dev)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 30000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        fetchPage(res.headers.location).then(resolve).catch(reject);
        return;
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function checkPage(url, selector = null) {
  try {
    let content = await fetchPage(url);
    
    // Basic selector extraction (for MVP)
    if (selector) {
      const idMatch = selector.match(/^#(.+)/);
      const classMatch = selector.match(/^\.(.+)/);
      
      if (idMatch) {
        const regex = new RegExp(`id=["']${idMatch[1]}["'][^>]*>([\\s\\S]*?)<\\/`, 'i');
        const match = content.match(regex);
        if (match) content = match[1];
      } else if (classMatch) {
        const regex = new RegExp(`class=["'][^"']*${classMatch[1]}[^"']*["'][^>]*>([\\s\\S]*?)<\\/`, 'i');
        const match = content.match(regex);
        if (match) content = match[1];
      }
    }
    
    // Normalize content
    const normalized = content
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    
    return { success: true, hash, preview: normalized.slice(0, 300) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = { checkPage };
