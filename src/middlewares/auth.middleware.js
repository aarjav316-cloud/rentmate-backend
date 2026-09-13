import jwt from 'jsonwebtoken';

// Using fallback strictly as prevention, but heavily relies on process.env in production
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'secret-access-key-replace-me';

/**
 * Protect Middleware
 * Ensures the user has a valid access token in the headers before proceeding to the controller.
 */
export const protect = async (req, res, next) => {
  try {
    let token;

    // 1. Look for token in standard Authorization header: "Bearer <token>"
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Future proofing: Easy to hook in `req.cookies.accessToken` later if you switch to HTTP-Only Cookies

    // 2. Reject seamlessly if no token exists
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. No token provided.',
      });
    }

    // 3. Verify signature securely. 
    // This process validates the cryptographic signature and checks the expiration timer
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET);

    // 4. Mount only the decoded lightweight properties to `req.user`.
    // Optimization: We DO NOT fetch the full User blob from MongoDB here. 
    // The service layers handle that natively when necessary, dropping unneeded DB overhead across generic requests.
    req.user = {
      id: decoded.id,
      role: decoded.role // Works beautifully if you decide to embed the role into the token during generation later
    };

    next();
  } catch (error) {
    // 5. Intelligent Error Interception for frontend tracking
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Access token expired.',
        code: 'TOKEN_EXPIRED', // Excellent flag for frontends to automate their `/refresh-token` Axios interceptors
      });
    }

    // Handles malformed, corrupted, or manipulated signatures safely
    return res.status(401).json({
      success: false,
      message: 'Invalid or malformed authentication token.',
    });
  }
};


/**
 * Role Authorization Middleware
 * Can be chained immediately after `protect` to restrict API paths.
 * Example usage: router.post('/create-listing', protect, authorize('landlord', 'admin'), controllerMethod)
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    // Failsafe to ensure it was used after `protect`
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required before verifying roles.',
      });
    }

    // Checks if the user's role array/string meets the allowed params (NOTE: required encoding role in JWT)
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have the required permissions to perform this action.',
      });
    }

    next();
  };
};



