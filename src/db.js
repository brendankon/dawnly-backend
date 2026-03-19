const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function postExists(redditId) {
  const { data } = await supabase
    .from('posts')
    .select('id')
    .eq('reddit_id', redditId)
    .maybeSingle();
  return !!data;
}

async function upsertPost(post) {
  const { error } = await supabase
    .from('posts')
    .upsert(post, { onConflict: 'reddit_id' });
  if (error) throw error;
}

async function getFeed(type, limit = 50, subs = null, minScore = 60) {
  let query = supabase
    .from('posts')
    .select('*')
    .contains('feed', [type])
    .gte('positivity_score', minScore)
    .gt('expires_at', new Date().toISOString())
    .order('positivity_score', { ascending: false })
    .limit(limit);

  if (subs && subs.length > 0) {
    query = query.in('subreddit', subs);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function updatePostStats(redditId, { score, upvote_ratio, num_comments, feed }) {
  const update = { score, upvote_ratio, num_comments };
  if (feed) update.feed = feed;
  const { error } = await supabase
    .from('posts')
    .update(update)
    .eq('reddit_id', redditId);
  if (error) throw error;
}

async function getPostsWithImages() {
  const { data, error } = await supabase
    .from('posts')
    .select('reddit_id, image_url')
    .not('image_url', 'is', null)
    .gt('expires_at', new Date().toISOString());
  if (error) throw error;
  return data || [];
}

async function deletePost(redditId) {
  const { error } = await supabase
    .from('posts')
    .delete()
    .eq('reddit_id', redditId);
  if (error) throw error;
}

async function deleteExpiredPosts() {
  const { error } = await supabase
    .from('posts')
    .delete()
    .lt('expires_at', new Date().toISOString());
  if (error) throw error;
}

module.exports = { supabase, postExists, upsertPost, updatePostStats, getFeed, getPostsWithImages, deletePost, deleteExpiredPosts };
