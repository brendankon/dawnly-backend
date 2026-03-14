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

async function getFeed(type, limit = 50, subs = null) {
  let query = supabase
    .from('posts')
    .select('*')
    .contains('feed', [type])
    .gte('positivity_score', 60)
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

async function deleteExpiredPosts() {
  const { error } = await supabase
    .from('posts')
    .delete()
    .lt('expires_at', new Date().toISOString());
  if (error) throw error;
}

module.exports = { supabase, postExists, upsertPost, getFeed, deleteExpiredPosts };
