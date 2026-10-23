// Vercel Serverless Function entry point
const app = require('../dist/server').default || require('../dist/server').app || require('../dist/server');

module.exports = app;
