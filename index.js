require('dotenv').config();

const app = require('./src/api');
const { startScheduler } = require('./src/scheduler');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Dawnly backend running on port ${PORT}`);
  startScheduler();
  console.log('Scheduler started — fetching every 15 minutes');
});
