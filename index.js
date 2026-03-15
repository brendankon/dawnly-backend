require('dotenv').config();

const app = require('./src/api');

// Scheduler runs via GitHub Actions (see .github/workflows/scheduler.yml)
// To run manually: npm run scheduler

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Dawnly backend running on port ${PORT}`);
});
