require('dotenv').config();
console.log(
  "API Key Loaded:",
  !!process.env.ANTHROPIC_API_KEY
);
const express = require('express');
const triageRoutes = require('./routes/triage.routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(triageRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`AI Ticket Triage Service running on port ${PORT}`);
});

module.exports = app;
