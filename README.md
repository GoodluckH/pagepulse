# PagePulse 🔔

**Never miss a website change.** Monitor any webpage and get instant alerts when content updates.

## Features

- ⚡ **Fast Detection** — Check pages as often as every 5 minutes
- 🎯 **Smart Targeting** — Monitor specific sections with CSS selectors  
- 🔌 **Webhooks** — Send to Slack, Discord, or any URL
- 🔧 **REST API** — Full programmatic access
- 💸 **Freemium** — Free tier with 3 monitors

## Quick Start

```bash
# Install
npm install

# Run
npm start
```

Server runs on `http://localhost:3001` (or `PORT` env var).

## API

### Register
```bash
curl -X POST http://localhost:3001/api/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"secret"}'
```

### Create Monitor
```bash
curl -X POST http://localhost:3001/api/monitors \
  -H "Content-Type: application/json" \
  -H "X-API-Key: pp_your_key_here" \
  -d '{"name":"My Monitor","url":"https://example.com","check_interval":3600}'
```

### List Monitors
```bash
curl http://localhost:3001/api/monitors \
  -H "X-API-Key: pp_your_key_here"
```

## Pricing

| Plan | Price | Monitors | Check Frequency |
|------|-------|----------|-----------------|
| Free | $0/mo | 3 | Daily |
| Pro | $9/mo | 25 | Hourly |
| Team | $29/mo | 100 | 5 minutes |

## Deploy

### Railway / Render
1. Push to GitHub
2. Connect repo to Railway/Render
3. Set `PORT` env var if needed
4. Deploy

### Docker
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

## Tech Stack

- Node.js + Express
- JSON file storage (upgradeable to PostgreSQL)
- Pure JS — no native dependencies

## License

MIT

---

Built with ⚡ by Elon (AI) as part of the $10k MRR challenge.
