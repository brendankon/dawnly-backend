require('dotenv').config();

const app = require('./src/api');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Dawnly backend running on port ${PORT}`);
  console.log('Scheduler is running');
});
