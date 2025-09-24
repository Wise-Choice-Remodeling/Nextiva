const jwt = require('jsonwebtoken');
const axios = require('axios');
const { logger } = require('../utils/logger');
const config = require('../config/config');
const { goHighLevelService } = require('../services/goHighLevelService');
const { nextivaCrmService } = require('../services/nextivaCrmService');

/**
 * Initiate GoHighLevel OAuth flow
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const initiateOAuth = (req, res) => {
  try {
    const { clientId, oauthUrl, redirectUri } = config.api.ghl;
    
    if (!clientId || !redirectUri) {
      return res.status(500).json({
        success: false,
        message: 'OAuth configuration missing. Please check GHL_CLIENT_ID and GHL_REDIRECT_URI environment variables.'
      });
    }
    
    // Required scopes for marketplace app
    const scopes = [
      'contacts.readonly',
      'contacts.write',
      'locations.readonly',
      'users.readonly'
    ].join(' ');
    
    const authUrl = `${oauthUrl}?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;
    
    res.status(200).json({
      success: true,
      authUrl,
      message: 'Redirect user to this URL to complete OAuth flow'
    });
  } catch (error) {
    logger.error('Error in initiateOAuth:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate OAuth flow'
    });
  }
};

/**
 * Handle OAuth callback and exchange code for token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const handleOAuthCallback = async (req, res, next) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Authorization code is required'
      });
    }
    
    const { clientId, clientSecret, tokenUrl, redirectUri } = config.api.ghl;
    
    if (!clientId || !clientSecret) {
      return res.status(500).json({
        success: false,
        message: 'OAuth configuration missing'
      });
    }
    
    // Exchange authorization code for access token
    const tokenResponse = await axios.post(
      tokenUrl,
      {
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    const { access_token, refresh_token, expires_in, scope } = tokenResponse.data;
    
    if (!access_token) {
      return res.status(401).json({
        success: false,
        message: 'Failed to obtain access token'
      });
    }
    
    // Validate the token by making a test API call
    const validationResult = await goHighLevelService.validateApiKey(access_token);
    
    if (!validationResult.success) {
      return res.status(401).json({
        success: false,
        message: 'Invalid access token received'
      });
    }
    
    // Generate JWT token for our API
    const jwtToken = jwt.sign(
      {
        ghlAccessToken: access_token,
        ghlRefreshToken: refresh_token,
        locationId: validationResult.locationId,
        scope: scope,
        tokenExpiry: Date.now() + (expires_in * 1000)
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Generate refresh token for our API
    const apiRefreshToken = jwt.sign(
      {
        ghlRefreshToken: refresh_token,
        locationId: validationResult.locationId
      },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );
    
    res.status(200).json({
      success: true,
      token: jwtToken,
      refreshToken: apiRefreshToken,
      expiresIn: 86400, // 24 hours in seconds
      tokenType: 'Bearer',
      location: {
        id: validationResult.locationId,
        name: validationResult.locationName
      },
      scope: scope
    });
  } catch (error) {
    logger.error('Error in handleOAuthCallback:', error);
    
    if (error.response && error.response.status === 401) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization code'
      });
    }
    
    next(error);
  }
};

/**
 * Verify authentication token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const verifyToken = (req, res) => {
  // If request reaches here, token is valid (verified by authenticate middleware)
  res.status(200).json({
    success: true,
    message: 'Token is valid',
    user: req.user
  });
};

/**
 * Refresh authentication token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token is required' });
    }
    
    // Verify refresh token
    jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(401).json({ success: false, message: 'Invalid refresh token' });
      }
      
      const { username, userId } = decoded;
      
      // Generate new JWT token
      const newToken = jwt.sign(
        { 
          username,
          userId
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      res.status(200).json({
        success: true,
        token: newToken,
        expiresIn: 86400, // 24 hours in seconds
        tokenType: 'Bearer'
      });
    });
  } catch (error) {
    logger.error('Error in refreshToken:', error);
    next(error);
  }
};

/**
 * Validate external authentication credentials for GoHighLevel marketplace
 * This endpoint is called by GoHighLevel to validate user credentials during app installation
 * It fetches credentials from GoHighLevel and authenticates against Thrio API to verify the credentials
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const validateExternalAuth = async (req, res) => {
  try {
    const { username, password, apiKey, locationId } = req.body;
    
    // Log the validation attempt (without sensitive data)
    if (logger && logger.info) {
      logger.info('External authentication validation attempt', {
        username: username ? username.substring(0, 3) + '***' : undefined,
        hasPassword: !!password,
        hasApiKey: !!apiKey,
        hasLocationId: !!locationId
      });
    } else {
      console.log('External authentication validation attempt:', {
        username: username ? username.substring(0, 3) + '***' : undefined,
        hasPassword: !!password,
        hasApiKey: !!apiKey,
        hasLocationId: !!locationId
      });
    }
    
    // Validate required credentials
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required',
        error: 'MISSING_CREDENTIALS'
      });
    }
    
    // If apiKey and locationId are provided, fetch credentials from GoHighLevel
    let credentialsToUse = { username, password };
    
    if (apiKey && locationId) {
      try {
        // Fetch stored credentials from GoHighLevel
        const storedCredentials = await fetchCredentialsFromGoHighLevel(apiKey, locationId);
        if (storedCredentials && storedCredentials.success) {
          credentialsToUse = {
            username: storedCredentials.username,
            password: storedCredentials.password
          };
          if (logger && logger.info) {
            logger.info('Successfully fetched credentials from GoHighLevel for location:', locationId);
          }
        } else {
          if (logger && logger.warn) {
            logger.warn('Failed to fetch credentials from GoHighLevel, using provided credentials');
          }
        }
      } catch (fetchError) {
        if (logger && logger.error) {
          logger.error('Error fetching credentials from GoHighLevel:', fetchError.message);
        }
        // Continue with provided credentials if fetch fails
      }
    }
    
    // Authenticate against Thrio using the credentials (either fetched or provided)
    const thrioAuthResult = await authenticateWithThrio(credentialsToUse.username, credentialsToUse.password);
    
    if (!thrioAuthResult || !thrioAuthResult.success) {
      const errorMessage = thrioAuthResult?.message || 'Unknown error';
      if (logger && logger.error) {
        logger.error('Thrio authentication failed:', errorMessage);
      } else {
        console.error('Thrio authentication failed:', errorMessage);
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials for Thrio API',
        error: 'INVALID_THRIO_CREDENTIALS',
        details: errorMessage
      });
    }
    
    // If we reach here, the Thrio credentials are valid
    // Store the credentials and tokens for future use
    // In production, you should encrypt and store these securely
    process.env.THRIO_USERNAME = credentialsToUse.username;
    process.env.THRIO_PASSWORD = credentialsToUse.password;
    process.env.THRIO_ACCESS_TOKEN = thrioAuthResult?.accessToken;
    if (thrioAuthResult?.refreshToken) {
      process.env.THRIO_REFRESH_TOKEN = thrioAuthResult.refreshToken;
    }
    
    if (logger && logger.info) {
      logger.info('Thrio authentication successful for user:', credentialsToUse.username || 'unknown');
    } else {
      console.log('Thrio authentication successful for user:', credentialsToUse.username || 'unknown');
    }
    
    // Return success response for GoHighLevel with Thrio token information
    res.status(200).json({
      success: true,
      message: 'Authentication successful',
      user: {
        username: credentialsToUse.username,
        authenticated: true,
        timestamp: new Date().toISOString(),
        thrioAuthenticated: true,
        thrioToken: thrioAuthResult?.accessToken,
        tokenType: thrioAuthResult?.tokenType,
        expiresIn: thrioAuthResult?.expiresIn,
        authorities: thrioAuthResult?.authorities,
        scope: thrioAuthResult?.scope
      }
    });
    
  } catch (error) {
    console.error('DEBUG: Error caught in validateExternalAuth:', error);
    console.error('DEBUG: Error type:', typeof error);
    console.error('DEBUG: Error keys:', error ? Object.keys(error) : 'undefined');
    
    // Safely log the error without triggering further issues
    try {
      if (error && typeof error === 'object') {
        // Create a safe object for logging
        const safeError = {
          message: error.message ? String(error.message) : 'Unknown error',
          stack: error.stack ? String(error.stack) : 'No stack'
        };
        if (logger && logger.error) {
          logger.error('Error in validateExternalAuth:', safeError);
        } else {
          console.error('Error in validateExternalAuth:', safeError);
        }
      } else {
        if (logger && logger.error) {
          logger.error('Error in validateExternalAuth:', error || 'Unknown error');
        } else {
          console.error('Error in validateExternalAuth:', error || 'Unknown error');
        }
      }
    } catch (logError) {
      console.error('Failed to log error:', logError);
      // Fallback to simple console logging
      console.error('Error in validateExternalAuth (fallback):', error || 'Unknown error');
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error during authentication',
      error: 'SERVER_ERROR'
    });
  }
};

/**
 * Fetch stored credentials from GoHighLevel for a specific location
 * This function retrieves Thrio credentials stored in GoHighLevel custom fields
 * @param {string} apiKey - GoHighLevel API key
 * @param {string} locationId - GoHighLevel location ID
 * @returns {Object} Credentials object with username and password
 */
const fetchCredentialsFromGoHighLevel = async (apiKey, locationId) => {
  try {
    if (logger && logger.info) {
      logger.info('Fetching credentials from GoHighLevel for location:', locationId);
    }
    
    // Create GoHighLevel API client
    const ghlClient = axios.create({
      baseURL: process.env.GHL_API_BASE_URL || 'https://rest.gohighlevel.com/v1',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    // Fetch location details to get custom fields
    const locationResponse = await ghlClient.get(`/locations/${locationId}`);
    
    if (!locationResponse.data || !locationResponse.data.success) {
      throw new Error('Failed to fetch location details from GoHighLevel');
    }
    
    const location = locationResponse.data.location;
    const customFields = location.customFields || {};
    
    // Look for Thrio credentials in custom fields
    // Common field names that might be used to store Thrio credentials
    const possibleFieldNames = [
      'thrio_username', 'thrioUsername', 'thrio_user', 'thrioUser',
      'thrio_password', 'thrioPassword', 'thrio_pass', 'thrioPass',
      'nextiva_username', 'nextivaUsername', 'nextiva_user', 'nextivaUser',
      'nextiva_password', 'nextivaPassword', 'nextiva_pass', 'nextivaPass'
    ];
    
    let foundUsername = null;
    let foundPassword = null;
    
    // Search through custom fields for credentials
    for (const [fieldName, fieldValue] of Object.entries(customFields)) {
      const lowerFieldName = fieldName.toLowerCase();
      if (possibleFieldNames.some(name => name.toLowerCase() === lowerFieldName && lowerFieldName.includes('user'))) {
        foundUsername = fieldValue;
      }
      if (possibleFieldNames.some(name => name.toLowerCase() === lowerFieldName && lowerFieldName.includes('pass'))) {
        foundPassword = fieldValue;
      }
    }
    
    // If credentials found in custom fields, return them
    if (foundUsername && foundPassword) {
      if (logger && logger.info) {
        logger.info('Successfully found Thrio credentials in GoHighLevel custom fields');
      }
      return {
        success: true,
        username: foundUsername,
        password: foundPassword,
        source: 'custom_fields'
      };
    }
    
    // If no credentials found in custom fields, try to fetch from contact notes or tags
    // This is a fallback mechanism - you might want to store credentials in a specific contact
    const contactsResponse = await ghlClient.get('/contacts', {
      params: {
        locationId: locationId,
        limit: 100
      }
    });
    
    if (contactsResponse.data && contactsResponse.data.contacts) {
      // Look for contacts with Thrio-related tags or notes
      for (const contact of contactsResponse.data.contacts) {
        const tags = contact.tags || [];
        const notes = contact.notes || '';
        
        // Check if contact has Thrio-related tags
        if (tags.some(tag => tag.toLowerCase().includes('thrio') || tag.toLowerCase().includes('nextiva'))) {
          // Try to extract credentials from notes or custom fields
          const contactCustomFields = contact.customFields || {};
          
          for (const [fieldName, fieldValue] of Object.entries(contactCustomFields)) {
            const lowerFieldName = fieldName.toLowerCase();
            if (possibleFieldNames.some(name => name.toLowerCase() === lowerFieldName && lowerFieldName.includes('user'))) {
              foundUsername = fieldValue;
            }
            if (possibleFieldNames.some(name => name.toLowerCase() === lowerFieldName && lowerFieldName.includes('pass'))) {
              foundPassword = fieldValue;
            }
          }
          
          if (foundUsername && foundPassword) {
            if (logger && logger.info) {
              logger.info('Successfully found Thrio credentials in GoHighLevel contact');
            }
            return {
              success: true,
              username: foundUsername,
              password: foundPassword,
              source: 'contact'
            };
          }
        }
      }
    }
    
    // If still no credentials found, return failure
    if (logger && logger.warn) {
      logger.warn('No Thrio credentials found in GoHighLevel for location:', locationId);
    }
    
    return {
      success: false,
      message: 'No Thrio credentials found in GoHighLevel',
      error: 'CREDENTIALS_NOT_FOUND'
    };
    
  } catch (error) {
    if (logger && logger.error) {
      logger.error('Error fetching credentials from GoHighLevel:', error.message);
    }
    
    return {
      success: false,
      message: 'Failed to fetch credentials from GoHighLevel',
      error: error.message || 'FETCH_ERROR'
    };
  }
};

/**
 * Authenticate against Thrio API using username and password
 * This function calls the Thrio token-with-authorities endpoint to get access and refresh tokens
 * @param {string} username - Thrio username
 * @param {string} password - Thrio password
 * @returns {Object} Authentication result with success status and tokens
 */
const authenticateWithThrio = async (username, password) => {
  try {
    // Enhanced demo mode for development/testing
    // This mode works with any credentials when in development
    if (process.env.NODE_ENV === 'development') {
      // Demo mode for specific test credentials
      if ((username === 'nextiva+wisechoiceremodeling@wisechoiceremodel.com' && 
           password === 'GHLwiseChoiceAPI2025!!') ||
          (username === 'demo@thrio.com' || username === 'test@thrio.com') && 
           password === 'demo123') {
        if (logger && logger.info) {
          logger.info('Using demo mode for Thrio authentication');
        } else {
          console.log('Using demo mode for Thrio authentication');
        }
        
        return {
          success: true,
          accessToken: 'demo-access-token-' + Date.now(),
          refreshToken: 'demo-refresh-token-' + Date.now(),
          tokenType: 'Bearer',
          expiresIn: 3600,
          authorities: ['ROLE_USER', 'ROLE_ADMIN'],
          scope: 'read write',
          demo: true,
          source: 'demo_mode'
        };
      }
      
      // Fallback demo mode for any credentials in development
      // This allows testing with dynamic credentials fetched from GoHighLevel
      if (logger && logger.info) {
        logger.info('Using fallback demo mode for Thrio authentication with username:', username);
      }
      
      return {
        success: true,
        accessToken: 'demo-access-token-' + Date.now() + '-' + username.replace(/[^a-zA-Z0-9]/g, ''),
        refreshToken: 'demo-refresh-token-' + Date.now() + '-' + username.replace(/[^a-zA-Z0-9]/g, ''),
        tokenType: 'Bearer',
        expiresIn: 3600,
        authorities: ['ROLE_USER', 'ROLE_ADMIN'],
        scope: 'read write',
        demo: true,
        source: 'fallback_demo_mode'
      };
    }
    
    const { baseUrl, tokenEndpoint } = config.api.thrio;
    const tokenUrl = `${baseUrl}${tokenEndpoint}`;
    
    if (logger && logger.info) {
      logger.info('Attempting Thrio authentication for user:', username || 'unknown');
    } else {
      console.log('Attempting Thrio authentication for user:', username || 'unknown');
    }
    
    // Make request to Thrio token-with-authorities endpoint
    // Convert data to URL encoded format for form submission
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    formData.append('grant_type', 'password');
    formData.append('client_id', 'thrio-client');
    
    const response = await axios.post(
      tokenUrl,
      formData.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        timeout: config.api.thrio.timeout
      }
    );
    
    if (response.data && response.data.access_token) {
      if (logger && logger.info) {
        logger.info('Thrio authentication successful for user:', username || 'unknown');
      } else {
        console.log('Thrio authentication successful for user:', username || 'unknown');
      }
      return {
        success: true,
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
        tokenType: response.data.token_type || 'Bearer',
        authorities: response.data.authorities || [],
        scope: response.data.scope
      };
    } else {
      if (logger && logger.error) {
        logger.error('Thrio authentication failed: No access token in response');
      } else {
        console.error('Thrio authentication failed: No access token in response');
      }
      return {
        success: false,
        message: 'Invalid response from Thrio authentication',
        error: 'NO_ACCESS_TOKEN'
      };
    }
    
  } catch (error) {
    // Safely handle the error object
    const errorMessage = error && typeof error === 'object' && error.message ? error.message : 'Unknown authentication error';
    if (logger && logger.error) {
      logger.error('Thrio authentication error:', errorMessage);
    } else {
      console.error('Thrio authentication error:', errorMessage);
    }
    
    if (error && typeof error === 'object' && error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      if (logger && logger.error) {
        logger.error('Thrio authentication error response:', {
          status: error.response.status,
          data: error.response.data,
          headers: error.response.headers
        });
      } else {
        console.error('Thrio authentication error response:', {
          status: error.response.status,
          data: error.response.data,
          headers: error.response.headers
        });
      }
      
      return {
        success: false,
        statusCode: error.response.status,
        message: error.response.data && (error.response.data.message || error.response.data.error) || 'Thrio authentication failed',
        error: error.response.data && error.response.data.error || 'AUTHENTICATION_FAILED'
      };
    } else if (error && typeof error === 'object' && error.request) {
      // The request was made but no response was received
      if (logger && logger.error) {
        logger.error('Thrio authentication no response:', { request: error.request });
      } else {
        console.error('Thrio authentication no response:', { request: error.request });
      }
      
      return {
        success: false,
        statusCode: 503,
        message: 'No response from Thrio authentication service',
        error: 'SERVICE_UNAVAILABLE'
      };
    } else {
      // Something happened in setting up the request that triggered an Error
      const setupErrorMessage = error && typeof error === 'object' && error.message ? error.message : 'Unknown request error';
      if (logger && logger.error) {
        logger.error('Thrio authentication request error:', { message: setupErrorMessage });
      } else {
        console.error('Thrio authentication request error:', { message: setupErrorMessage });
      }
      
      return {
        success: false,
        statusCode: 500,
        message: 'Error setting up request to Thrio authentication',
        error: 'REQUEST_SETUP_ERROR'
      };
    }
  }
};

/**
 * Helper function to validate user credentials
 * Replace this with your actual user validation logic
 * @param {string} username - User's username
 * @param {string} password - User's password
 * @returns {boolean} - Whether credentials are valid
 */
const validateUserCredentials = async (username, password) => {
  // TODO: Implement actual user validation logic
  // This is a placeholder implementation
  
  // Example: Check against environment variables for demo purposes
  const validUsername = process.env.DEMO_USERNAME || 'admin';
  const validPassword = process.env.DEMO_PASSWORD || 'password123';
  
  return username === validUsername && password === validPassword;
};

module.exports = {
  initiateOAuth,
  handleOAuthCallback,
  verifyToken,
  refreshToken,
  validateExternalAuth
};