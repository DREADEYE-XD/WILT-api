const app = require('../index.js');

// Vercel serverless function handler
module.exports = (req, res) => {
  app(req, res);
};