// const jwt = require("jsonwebtoken")
// const { pool } = require("../config/database")

// const authenticateToken = async (req, res, next) => {
//   const authHeader = req.headers["authorization"]
//   const token = authHeader && authHeader.split(" ")[1]

//   if (!token) {
//     return res.status(401).json({ error: "Access token required" })
//   }

//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET)

//     // Get user from database
//     const [users] = await pool.execute("SELECT id, name, email, role, is_active FROM users WHERE id = ?", [
//       decoded.userId,
//     ])

//     if (users.length === 0 || !users[0].is_active) {
//       return res.status(401).json({ error: "Invalid or inactive user" })
//     }

//     req.user = users[0]
//     next()
//   } catch (error) {
//     return res.status(403).json({ error: "Invalid token" })
//   }
// }

// const requireRole = (roles) => {
//   return (req, res, next) => {
//     if (!roles.includes(req.user.role)) {
//       return res.status(403).json({ error: "Insufficient permissions" })
//     }
//     next()
//   }
// }

// module.exports = { authenticateToken, requireRole }



//testing
// auth.js

// const jwt = require("jsonwebtoken")
// const { pool } = require("../config/database")

// const authenticateToken = async (req, res, next) => {
//   try {
//     const authHeader = req.headers["authorization"]

//     if (!authHeader || !authHeader.startsWith("Bearer ")) {
//       return res.status(401).json({ error: "Access token required" })
//     }

//     const token = authHeader.split(" ")[1]

//     if (!token) {
//       return res.status(401).json({ error: "Access token required" })
//     }

//     let decoded
//     try {
//       decoded = jwt.verify(token, process.env.JWT_SECRET)
//     } catch (err) {
//       // Token malformed / expired / bad signature
//       return res.status(401).json({ error: "Invalid or expired token" })
//     }

//     // Get user from database
//     const [users] = await pool.execute(
//       "SELECT id, name, email, role, is_active FROM users WHERE id = ?",
//       [decoded.userId],
//     )

//     if (!users || users.length === 0) {
//       return res.status(401).json({ error: "User not found" })
//     }

//     const user = users[0]

//     if (!user.is_active) {
//       return res.status(403).json({ error: "User is inactive" })
//     }

//     // Attach user to request for downstream handlers
//     req.user = user
//     next()
//   } catch (error) {
//     console.error("Auth middleware error:", error)
//     return res.status(500).json({ error: "Authentication failed" })
//   }
// }

// const requireRole = (roles) => {
//   // Normalize to array and defensive checks
//   const allowedRoles = Array.isArray(roles) ? roles : [roles]

//   return (req, res, next) => {
//     if (!req.user) {
//       return res.status(401).json({ error: "Not authenticated" })
//     }

//     if (!allowedRoles.includes(req.user.role)) {
//       return res.status(403).json({ error: "Insufficient permissions" })
//     }

//     next()
//   }
// }

// module.exports = { authenticateToken, requireRole }


//testing (17-12-2025)

// middleware/auth.js

const jwt = require("jsonwebtoken");
const { pool } = require("../config/database");

// Authentication middleware: verifies JWT and loads user from DB
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"] || req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Access token required" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      // decoded is expected to have: { id, email, role, name?, is_active?, iat, exp }
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Use the same key as used when signing the token (id, not userId)
    const userId = decoded.id;
    if (!userId) {
      // Token structure is wrong; likely old token signed with different payload
      return res.status(401).json({ error: "Invalid token payload" });
    }

    const [users] = await pool.execute(
      "SELECT id, name, email, role, is_active FROM users WHERE id = ?",
      [userId]
    );

    if (!users || users.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(403).json({ error: "User is inactive" });
    }

    // Attach user to request for downstream handlers
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      is_active: user.is_active,
    };

    return next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
};

// Role-based authorization middleware
const requireRole = (roles) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    return next();
  };
};

module.exports = { authenticateToken, requireRole };
