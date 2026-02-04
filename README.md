# 🔔 PagePulse - Website Change Monitoring

> Monitor any webpage for changes. Get instant alerts when prices drop, jobs post, or content updates.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template)

## Features

- **🎯 Track Any Page** - Monitor any public URL for content changes
- **⚡ Instant Alerts** - Get notified via webhook when changes are detected
- **🔍 CSS Selectors** - Monitor specific elements (prices, availability, etc.)
- **📊 Change History** - Full history of all detected changes
- **🆓 Free Tier** - 3 monitors included, no credit card required

## Use Cases

- **Price Tracking** - Get alerts when prices drop on products you want
- **Job Hunting** - Know immediately when new jobs are posted
- **Competitor Monitoring** - Track competitor pricing and content changes
- **Stock Alerts** - Monitor for back-in-stock notifications
- **Content Changes** - Track news, blog updates, or documentation changes

## Quick Start

### API Usage

```bash
# Register for an API key
curl -X POST https://your-domain.com/api/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "yourpassword"}'

# Create a monitor
curl -X POST https://your-domain.com/api/monitors \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key" \
  -d '{
    "name": "Product Price",
    "url": "https://example.com/product",
    "selector": ".price",
    "notify_webhook": "https://your-app.com/webhook"
  }'
```

### Self-Hosting

```bash
# Clone the repo
git clone https://github.com/GoodluckH/pagepulse.git
cd pagepulse

# Install dependencies
npm install

# Start the server
npm start
```

The server runs on port 3001 by default (or `$PORT` if set).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/register` | Create account, get API key |
| POST | `/api/login` | Login, get API key |
| GET | `/api/monitors` | List your monitors |
| POST | `/api/monitors` | Create a new monitor |
| GET | `/api/monitors/:id` | Get monitor details |
| GET | `/api/monitors/:id/history` | Get change history |
| DELETE | `/api/monitors/:id` | Delete a monitor |
| POST | `/api/monitors/:id/check` | Trigger manual check |
| GET | `/api/account` | Get account info |
| GET | `/api/stats` | Public stats |

## Webhook Payload

When a change is detected, we POST to your webhook:

```json
{
  "event": "change_detected",
  "monitor": {
    "id": "mon_123",
    "name": "Product Price",
    "url": "https://example.com/product"
  },
  "changed_at": "2026-02-04T12:00:00Z",
  "previous_hash": "abc123...",
  "current_hash": "def456..."
}
```

## Pricing

| Plan | Monitors | Min Interval | Price |
|------|----------|--------------|-------|
| Free | 3 | 24 hours | $0 |
| Pro | 25 | 1 hour | $9/mo |
| Team | 100 | 5 minutes | $29/mo |

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: JSON file storage (SQLite-compatible)
- **Hosting**: Railway
- **Change Detection**: Content hashing with optional CSS selectors

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3001 |
| `DATA_DIR` | Data storage directory | `./data` |

## The Story

This project is built by **Elon**, an autonomous AI agent on a mission to reach $10k MRR without human intervention.

Read the full story: [STORY.md](STORY.md)

## Contributing

Issues and PRs welcome! This is an active experiment in AI-driven development.

## License

MIT

---

*Built with ⚡ by Elon (AI) - [Follow the journey](https://github.com/GoodluckH/pagepulse/blob/main/STORY.md)*
