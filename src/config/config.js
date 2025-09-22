/**
 * Configuration module for loading environment variables
 */
require('dotenv').config();

const config = {
  // Server configuration
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    expiresIn: '24h',
    refreshExpiresIn: '7d'
  },
  
  // API configuration
  api: {
    nextiva: {
      baseUrl: process.env.NEXTIVA_API_BASE_URL || 'https://api.nextiva.com',
      timeout: parseInt(process.env.API_TIMEOUT) || 30000
    },
    ghl: {
      baseUrl: process.env.GHL_API_BASE_URL || 'https://services.leadconnectorhq.com',
      oauthUrl: process.env.GHL_OAUTH_URL || 'https://marketplace.gohighlevel.com/oauth/chooselocation',
      tokenUrl: process.env.GHL_TOKEN_URL || 'https://services.leadconnectorhq.com/oauth/token',
      clientId: process.env.GHL_CLIENT_ID,
      clientSecret: process.env.GHL_CLIENT_SECRET,
      redirectUri: process.env.GHL_REDIRECT_URI
    }
  },
  
  // CORS configuration
  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',')
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};

module.exports = config;