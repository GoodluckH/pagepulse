const https = require('https');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'PagePulse <notifications@pagepulse.dev>';

/**
 * Send email notification via Resend API
 */
async function sendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) {
    console.log('[EMAIL] Skipped - RESEND_API_KEY not configured');
    return { success: false, error: 'No API key' };
  }

  const payload = JSON.stringify({
    from: FROM_EMAIL,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[EMAIL] Sent to ${to}`);
          resolve({ success: true, data: JSON.parse(data) });
        } else {
          console.error(`[EMAIL] Failed: ${res.statusCode} - ${data}`);
          resolve({ success: false, error: data });
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[EMAIL] Error: ${err.message}`);
      resolve({ success: false, error: err.message });
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Send change notification for a monitor
 */
async function notifyChange(monitor, user) {
  const subject = `🔔 Change detected: ${monitor.name}`;
  
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Page Change Detected</h2>
      <p>Your monitored page has changed:</p>
      
      <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0;"><strong>Monitor:</strong> ${monitor.name}</p>
        <p style="margin: 0 0 8px 0;"><strong>URL:</strong> <a href="${monitor.url}">${monitor.url}</a></p>
        ${monitor.selector ? `<p style="margin: 0 0 8px 0;"><strong>Selector:</strong> ${monitor.selector}</p>` : ''}
        <p style="margin: 0;"><strong>Detected at:</strong> ${new Date().toUTCString()}</p>
      </div>
      
      <p><a href="${monitor.url}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">View Page</a></p>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      <p style="color: #6b7280; font-size: 14px;">
        You're receiving this because you set up monitoring for this URL on PagePulse.
      </p>
    </div>
  `;

  const text = `
Page Change Detected

Monitor: ${monitor.name}
URL: ${monitor.url}
${monitor.selector ? `Selector: ${monitor.selector}` : ''}
Detected at: ${new Date().toUTCString()}

Visit the page: ${monitor.url}
  `.trim();

  return sendEmail({
    to: user.email,
    subject,
    html,
    text
  });
}

/**
 * Send webhook notification (if configured)
 */
async function notifyWebhook(monitor, webhookUrl) {
  if (!webhookUrl) return { success: false, error: 'No webhook URL' };

  const payload = JSON.stringify({
    event: 'page_changed',
    monitor: {
      id: monitor.id,
      name: monitor.name,
      url: monitor.url,
      selector: monitor.selector
    },
    timestamp: new Date().toISOString()
  });

  return new Promise((resolve) => {
    const url = new URL(webhookUrl);
    const protocol = url.protocol === 'https:' ? https : require('http');

    const req = protocol.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'PagePulse/1.0'
      }
    }, (res) => {
      console.log(`[WEBHOOK] ${webhookUrl} - ${res.statusCode}`);
      resolve({ success: res.statusCode >= 200 && res.statusCode < 300 });
    });

    req.on('error', (err) => {
      console.error(`[WEBHOOK] Error: ${err.message}`);
      resolve({ success: false, error: err.message });
    });

    req.write(payload);
    req.end();
  });
}

module.exports = {
  sendEmail,
  notifyChange,
  notifyWebhook
};
