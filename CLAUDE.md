# Dawnly — Backend

Node.js backend for the Dawnly iOS app. Dawnly is a positivity-filtered 
news reader that fetches Reddit's popular and news feeds, scores each post 
for positive sentiment, and serves a filtered feed to the iOS app.

## Architecture
- Cron scheduler fetches r/popular and a news multi-subreddit feed from 
  Reddit every 15 minutes (no auth required — public JSON endpoints)
- For each new post, top 5 comments are fetched from Reddit's comments 
  endpoint and used as part of sentiment scoring
- Each new post is scored for positivity using Groq (text + comments) 
  and Gemini Flash (images)
- Posts that appear in both feeds are deduplicated by post ID
- Scored posts are stored in Supabase with a 24h TTL
- A REST API serves the filtered feed to the iOS app

## API endpoints
- GET /feed?type=popular — returns top scored posts from popular feed
- GET /feed?type=news — returns top scored posts from news feed
- Query params: limit (default 50), subs (comma-separated subreddit filter)

## Tech stack
- Node.js + Express
- node-cron for scheduling
- @supabase/supabase-js for the database
- @google/generative-ai for Gemini
- node-fetch for HTTP requests
- dotenv for environment variables

## Environment variables
SUPABASE_URL, SUPABASE_SERVICE_KEY, GROQ_API_KEY, GEMINI_API_KEY, PORT

## Supabase tables
posts: id, reddit_id, title, body, url, subreddit, feed (array), 
       score, upvote_ratio, num_comments, image_url, thumbnail_url, 
       positivity_score, text_score, image_score, comment_score,
       top_comments (text array), created_utc, scored_at, expires_at

## Reddit feeds
- Popular: https://www.reddit.com/r/popular.json?sort=hot&limit=100
- News: https://www.reddit.com/r/news+worldnews+politics+technology+
         science+business+environment+upliftingnews.json?sort=hot&limit=100
- User-Agent: Dawnly/1.0 (positive news reader)

## Comment fetching
- Endpoint: https://www.reddit.com/r/{subreddit}/comments/{post_id}.json?limit=5&sort=top
- Fetch top 5 comments per post, for new posts only
- Filter out deleted/removed comments ([deleted], [removed])
- Rate limit: 7 second delay between comment fetch requests to stay 
  within Reddit's 10 requests/minute unauthenticated limit
- Store fetched comments in top_comments column for debugging

## Scoring logic
- Text scoring via Groq (openai/gpt-oss-120b) — title + body
- Comment scoring via Groq — average sentiment of top 5 comments
- Image scoring via Gemini (gemini-3.1-flash-lite, 15 RPM / 500 daily) — only if post has image
- Score range 0–100 for each component

### Scoring weights
With image:
  final = (text_score × 0.30) + (comment_score × 0.30) + (image_score × 0.40)

Without image:
  final = (text_score × 0.60) + (comment_score × 0.40)

- Posts below a positivity_score of 60 are filtered out of the feed
- Skip scoring entirely if reddit_id already exists in DB (cache)

## Folder structure
src/
  scheduler.js    — cron job, Reddit feed fetching, comment fetching
  scorer.js       — Groq text/comment scoring and Gemini image scoring
  deduplicator.js — merge and deduplicate posts from both feeds
  db.js           — Supabase client and query helpers
  api.js          — Express routes
index.js          — entry point that starts cron + server