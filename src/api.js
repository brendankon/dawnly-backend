const express = require('express');

const app = express();

app.get('/feed', (req, res) => {
  const type = req.query.type || 'popular';
  const limit = parseInt(req.query.limit) || 50;

  res.json({ posts: [], message: 'coming soon' });
});

module.exports = app;
