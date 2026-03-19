const cron = require('node-cron');
const { postExists, upsertPost, updatePostStats, getPostsWithImages, deletePost, deleteExpiredPosts } = require('./db');
const { scorePost } = require('./scorer');
const { deduplicatePosts } = require('./deduplicator');

const USER_AGENT = 'Dawnly/1.0 (positive news reader)';
const POPULAR_URL = 'https://oauth.reddit.com/r/popular.json?sort=hot&limit=100';
const NEWS_URL = 'https://oauth.reddit.com/r/news+worldnews+politics+technology+science+business+environment+upliftingnews.json?sort=hot&limit=100';
const COMMENT_DELAY_MS = 7000;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getRedditToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reddit auth failed ${res.status}: ${body}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  console.log('[scheduler] Reddit OAuth token acquired');
  return cachedToken;
}

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

async function fetchFeed(url, targetCount = 150) {
  const token = await getRedditToken();
  let allPosts = [];
  let after = null;

  while (allPosts.length < targetCount) {
    const pageUrl = after ? `${url}&after=${after}` : url;
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!res.ok) throw new Error(`Reddit fetch failed ${res.status}: ${pageUrl}`);
    const json = await res.json();

    const posts = json.data.children
      .filter((child) => !child.data.is_video && !child.data.over_18)
      .map(parseRedditPost);
    allPosts = allPosts.concat(posts);

    after = json.data.after;
    if (!after) break; // no more pages
  }

  return allPosts.slice(0, targetCount);
}

async function fetchComments(subreddit, postId) {
  const token = await getRedditToken();
  const url = `https://oauth.reddit.com/r/${subreddit}/comments/${postId}.json?limit=5&sort=top`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Authorization': `Bearer ${token}`,
    },
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

let isRunning = false;

async function runFetchAndScore() {
  if (isRunning) {
    console.log('[scheduler] Previous run still in progress, skipping');
    return;
  }
  isRunning = true;
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
  const checkedIds = new Set();

  for (const post of posts) {
    checkedIds.add(post.reddit_id);
    const exists = await postExists(post.reddit_id);
    if (exists) {
      // Check if the post has been removed/deleted by mods
      const bodyText = (post.body || '').trim();
      if (bodyText === '[removed]' || bodyText === '[deleted]' || post.title === '[deleted by user]') {
        console.log(`[scheduler] Post ${post.reddit_id} removed/deleted, deleting from DB`);
        await deletePost(post.reddit_id);
        skipped++;
        continue;
      }

      // Check if the image is still accessible
      if (post.image_url) {
        try {
          const headRes = await fetch(post.image_url, { method: 'HEAD' });
          const status = headRes.status;
          const contentLength = parseInt(headRes.headers.get('content-length') || '0', 10);
          // Reddit serves a ~1KB placeholder image when the original is deleted
          if (status === 404 || status === 403 || (status === 200 && contentLength > 0 && contentLength < 5000)) {
            console.log(`[scheduler] Image gone for post ${post.reddit_id} (status=${status}, size=${contentLength}), deleting from DB`);
            await deletePost(post.reddit_id);
            skipped++;
            continue;
          }
        } catch (err) {
          console.warn(`[scheduler] Image check failed for ${post.reddit_id}: ${err.message}`);
        }
      }

      await updatePostStats(post.reddit_id, {
        score: post.score,
        upvote_ratio: post.upvote_ratio,
        num_comments: post.num_comments,
        feed: post.feed,
      });
      skipped++;
      continue;
    }

    // Fetch comments with rate limiting
    console.log(`[scheduler] Processing post ${post.reddit_id} (${post.subreddit}): ${post.title.substring(0, 60)}`);
    const comments = await fetchComments(post.subreddit, post.reddit_id);
    post.top_comments = comments;
    console.log(`[scheduler] Fetched ${comments.length} comments, waiting...`);
    await sleep(COMMENT_DELAY_MS);

    // Score the post
    try {
      const scores = await scorePost(post);
      const now = new Date();
      const expires = new Date(now.getTime() + 8 * 60 * 60 * 1000);

      await upsertPost({
        ...post,
        ...scores,
        scored_at: now.toISOString(),
        expires_at: expires.toISOString(),
      });
      scored++;
      console.log(`[scheduler] Scored post ${post.reddit_id}: ${scores.positivity_score} (text=${scores.text_score} comment=${scores.comment_score} image=${scores.image_score})`);
    } catch (err) {
      console.error(`[scheduler] Failed to score post ${post.reddit_id}:`, err.message);
    }
  }

  // Sweep DB for deleted images on posts not already checked above
  try {
    const dbPosts = await getPostsWithImages();
    const toCheck = dbPosts.filter((p) => !checkedIds.has(p.reddit_id));
    if (toCheck.length > 0) {
      console.log(`[scheduler] Checking ${toCheck.length} DB posts for deleted images...`);
      let deleted = 0;
      for (const post of toCheck) {
        try {
          const headRes = await fetch(post.image_url, { method: 'HEAD' });
          const status = headRes.status;
          const contentLength = parseInt(headRes.headers.get('content-length') || '0', 10);
          if (status === 404 || status === 403 || (status === 200 && contentLength > 0 && contentLength < 5000)) {
            console.log(`[scheduler] Image gone for DB post ${post.reddit_id} (status=${status}, size=${contentLength}), deleting`);
            await deletePost(post.reddit_id);
            deleted++;
          }
        } catch (err) {
          console.warn(`[scheduler] Image check failed for DB post ${post.reddit_id}: ${err.message}`);
        }
        await sleep(800);
      }
      console.log(`[scheduler] Image sweep done. Deleted ${deleted}/${toCheck.length} posts`);
    }
  } catch (err) {
    console.error(`[scheduler] Image sweep failed: ${err.message}`);
  }

  // Clean up expired posts
  await deleteExpiredPosts();

  console.log(`[scheduler] Done. Scored: ${scored}, Skipped: ${skipped}`);
  isRunning = false;
}

function startScheduler() {
  // Temporarily disabled — re-enable when ready to fetch new data
  cron.schedule('*/60 * * * *', () => {
    runFetchAndScore().catch((err) => {
      console.error('[scheduler] Cron run failed:', err.message);
    });
  });

  runFetchAndScore().catch((err) => {
    console.error('[scheduler] Initial run failed:', err.message);
  });

  // console.log('[scheduler] Cron disabled — serving existing data only');
}

module.exports = { startScheduler, runFetchAndScore };