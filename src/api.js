const express = require('express');
const { getFeed } = require('./db');

const app = express();

app.get('/feed', async (req, res) => {
  try {
    const type = req.query.type || 'popular';
    const limit = parseInt(req.query.limit) || 50;
    const subs = req.query.subs ? req.query.subs.split(',') : null;

    const posts = await getFeed(type, limit, subs);
    res.json({ posts });
  } catch (err) {
    console.error('[api] Feed error:', err.message);
    res.status(500).json({ error: 'Failed to fetch feed' });
  }
});

module.exports = app;
