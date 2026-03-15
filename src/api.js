const express = require('express');
const rateLimit = require('express-rate-limit');
const { getFeed } = require('./db');

const app = express();
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

app.use(limiter);

app.get('/feed', async (req, res) => {
  try {
    const type = req.query.type || 'popular';
    const limit = parseInt(req.query.limit) || 50;
    const subs = req.query.subs ? req.query.subs.split(',') : null;
    const minScore = parseInt(req.query.min_score) || 60;

    const posts = await getFeed(type, limit, subs, minScore);
    res.json({ posts });
  } catch (err) {
    console.error('[api] Feed error:', err.message);
    res.status(500).json({ error: 'Failed to fetch feed' });
  }
});

module.exports = app;
