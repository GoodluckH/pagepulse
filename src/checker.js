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
    
    // Extract text-only version for diff (remove HTML tags)
    const textContent = normalized
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10000); // Limit to 10KB for storage
    
    return { success: true, hash, preview: normalized.slice(0, 300), content: textContent };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Compute a simple line-by-line diff
function computeDiff(oldContent, newContent) {
  if (!oldContent || !newContent) return null;
  
  const oldWords = oldContent.split(/\s+/);
  const newWords = newContent.split(/\s+/);
  
  const added = [];
  const removed = [];
  
  // Simple word-level diff
  const oldSet = new Set(oldWords);
  const newSet = new Set(newWords);
  
  for (const word of newWords) {
    if (!oldSet.has(word) && word.length > 2) {
      added.push(word);
    }
  }
  
  for (const word of oldWords) {
    if (!newSet.has(word) && word.length > 2) {
      removed.push(word);
    }
  }
  
  // Generate summary
  let summary = '';
  if (removed.length > 0) {
    summary += `Removed: "${removed.slice(0, 5).join(', ')}${removed.length > 5 ? '...' : ''}" `;
  }
  if (added.length > 0) {
    summary += `Added: "${added.slice(0, 5).join(', ')}${added.length > 5 ? '...' : ''}"`;
  }
  
  return {
    added: added.slice(0, 20),
    removed: removed.slice(0, 20),
    summary: summary.trim() || 'Content structure changed'
  };
}

module.exports = { checkPage, computeDiff };
