const cron = require('node-cron');
const { postExists, upsertPost, deleteExpiredPosts } = require('./db');
const { scorePost } = require('./scorer');
const { deduplicatePosts } = require('./deduplicator');

const USER_AGENT = 'Dawnly/1.0 (positive news reader)';
const POPULAR_URL = 'https://www.reddit.com/r/popular.json?sort=hot&limit=100';
const NEWS_URL = 'https://www.reddit.com/r/news+worldnews+politics+technology+science+business+environment+upliftingnews.json?sort=hot&limit=100';
const COMMENT_DELAY_MS = 7000;

function parseRedditPost(child) {
  const d = child.data;
  const imageUrl = isImageUrl(d.url) ? d.url : null;
  return {
    reddit_id: d.id,
    title: d.title,
    body: d.selftext || null,
    url: d.url,
    subreddit: d.subreddit,
    score: d.score,
    upvote_ratio: d.upvote_ratio,
    num_comments: d.num_comments,
    image_url: imageUrl,
    thumbnail_url: d.thumbnail && d.thumbnail.startsWith('http') ? d.thumbnail : null,
    created_utc: new Date(d.created_utc * 1000).toISOString(),
  };
}

function isImageUrl(url) {
  if (!url) return false;
  return /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url) ||
    url.includes('i.redd.it') ||
    url.includes('i.imgur.com');
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Reddit fetch failed ${res.status}: ${url}`);
  const json = await res.json();
  return json.data.children.map(parseRedditPost);
}

async function fetchComments(subreddit, postId) {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=5&sort=top`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) return [];

  const json = await res.json();
  const commentListing = json[1];
  if (!commentListing || !commentListing.data) return [];

  return commentListing.data.children
    .filter((c) => c.kind === 't1')
    .map((c) => c.data.body)
    .filter((body) => body && body !== '[deleted]' && body !== '[removed]')
    .slice(0, 5);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runFetchAndScore() {
  console.log('[scheduler] Starting feed fetch...');

  const [popularPosts, newsPosts] = await Promise.all([
    fetchFeed(POPULAR_URL),
    fetchFeed(NEWS_URL),
  ]);
  console.log(`[scheduler] Fetched ${popularPosts.length} popular, ${newsPosts.length} news posts`);

  const posts = deduplicatePosts(popularPosts, newsPosts);
  console.log(`[scheduler] ${posts.length} unique posts after dedup`);

  let scored = 0;
  let skipped = 0;

  for (const post of posts) {
    const exists = await postExists(post.reddit_id);
    if (exists) {
      skipped++;
      continue;
    }

    // Fetch comments with rate limiting
    const comments = await fetchComments(post.subreddit, post.reddit_id);
    post.top_comments = comments;
    await sleep(COMMENT_DELAY_MS);

    // Score the post
    try {
      const scores = await scorePost(post);
      const now = new Date();
      const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await upsertPost({
        ...post,
        ...scores,
        scored_at: now.toISOString(),
        expires_at: expires.toISOString(),
      });
      scored++;
    } catch (err) {
      console.error(`[scheduler] Failed to score post ${post.reddit_id}:`, err.message);
    }
  }

  // Clean up expired posts
  await deleteExpiredPosts();

  console.log(`[scheduler] Done. Scored: ${scored}, Skipped: ${skipped}`);
}

function startScheduler() {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    runFetchAndScore().catch((err) => {
      console.error('[scheduler] Cron run failed:', err.message);
    });
  });

  // Also run immediately on startup
  runFetchAndScore().catch((err) => {
    console.error('[scheduler] Initial run failed:', err.message);
  });
}

module.exports = { startScheduler, runFetchAndScore };
