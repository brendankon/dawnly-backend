function deduplicatePosts(popularPosts, newsPosts) {
  const map = new Map();

  for (const post of popularPosts) {
    map.set(post.reddit_id, { ...post, feed: ['popular'] });
  }

  for (const post of newsPosts) {
    if (map.has(post.reddit_id)) {
      const existing = map.get(post.reddit_id);
      existing.feed.push('news');
    } else {
      map.set(post.reddit_id, { ...post, feed: ['news'] });
    }
  }

  return Array.from(map.values());
}

module.exports = { deduplicatePosts };
