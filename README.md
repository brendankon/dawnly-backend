# Dawnly Backend

Node.js backend for the Dawnly iOS app — a positivity-filtered news reader that fetches Reddit feeds, scores posts for positive sentiment using LLMs, and serves a curated feed via REST API.

## How it works

1. A GitHub Actions cron job fetches r/popular and a multi-subreddit news feed from Reddit every 60 minutes
2. Each post's top 5 comments are fetched for sentiment context
3. Posts are scored for positivity using Groq (text + comments) and Gemini Flash (images)
4. Scored posts are stored in Supabase with a 12h TTL
5. An Express API on Render serves the filtered feed to the iOS app

## API

```
GET /feed?type=popular&limit=50&min_score=60
GET /feed?type=news&limit=50&subs=technology,science&min_score=60
```

| Param | Default | Description |
|-------|---------|-------------|
| `type` | `popular` | Feed type: `popular` or `news` |
| `limit` | `50` | Max posts to return |
| `subs` | — | Comma-separated subreddit filter |
| `min_score` | `60` | Minimum positivity score (0-100) |

## Setup

```bash
npm install
```

### Environment variables

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
GROQ_API_KEY=
GEMINI_API_KEY=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
PORT=3000
```

### Run the API server

```bash
node index.js
```

### Run the scheduler manually

```bash
npm run scheduler
```

## Scoring

Posts are scored 0-100 across three components:

- **Text** — title + body scored via Groq
- **Comments** — top 5 comments scored via Groq
- **Image** — post image scored via Gemini Flash (when present)

**Weights:**
- With image: `text(0.3) + comments(0.3) + image(0.4)`
- Without image: `text(0.6) + comments(0.4)`

Groq uses a model fallback chain (`gpt-oss-120b` → `gpt-oss-20b` → `llama-3.3-70b-versatile`) on rate limit or empty responses.

## Deployment

- **API server**: Render (build: `npm install`, start: `node index.js`)
- **Scheduler**: GitHub Actions (`.github/workflows/scheduler.yml`, runs hourly)
