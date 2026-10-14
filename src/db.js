const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'urls.sqlite');
const db = new DatabaseSync(dbPath);

// Initialize database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    original_url TEXT NOT NULL,
    title TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    clicks INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_code TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    ip TEXT,
    browser TEXT,
    os TEXT,
    device_type TEXT,
    referrer TEXT,
    FOREIGN KEY(url_code) REFERENCES urls(code) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_urls_code ON urls(code);
  CREATE INDEX IF NOT EXISTS idx_clicks_code ON clicks(url_code);
  CREATE INDEX IF NOT EXISTS idx_clicks_timestamp ON clicks(timestamp);
`);

// Base62 helper for clean, compact unique IDs
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function generateRandomCode(length = 6) {
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * BASE62.length);
    result += BASE62[randomIndex];
  }
  return result;
}

const dbService = {
  // Check if code is available
  isCodeAvailable(code) {
    const stmt = db.prepare('SELECT id FROM urls WHERE code = ?');
    const existing = stmt.get(code);
    return !existing;
  },

  // Create short URL
  createShortUrl({ originalUrl, customCode, title, expiresInHours }) {
    let code = customCode ? customCode.trim() : null;

    if (code) {
      // Validate custom code
      if (!/^[a-zA-Z0-9_-]{3,30}$/.test(code)) {
        throw new Error('Custom alias must be 3-30 characters with alphanumeric, dash, or underscore.');
      }
      if (!this.isCodeAvailable(code)) {
        throw new Error('This custom alias is already taken. Please choose another.');
      }
    } else {
      // Generate unique random code
      let attempts = 0;
      do {
        code = generateRandomCode(6);
        attempts++;
        if (attempts > 10) code = generateRandomCode(8);
      } while (!this.isCodeAvailable(code));
    }

    const now = new Date();
    const createdAt = now.toISOString();
    let expiresAt = null;

    if (expiresInHours && !isNaN(expiresInHours) && Number(expiresInHours) > 0) {
      const expDate = new Date(now.getTime() + Number(expiresInHours) * 60 * 60 * 1000);
      expiresAt = expDate.toISOString();
    }

    const insertStmt = db.prepare(`
      INSERT INTO urls (code, original_url, title, created_at, expires_at, clicks, is_active)
      VALUES (?, ?, ?, ?, ?, 0, 1)
    `);

    insertStmt.run(code, originalUrl, title || null, createdAt, expiresAt);

    return this.getUrlByCode(code);
  },

  // Get single URL by code
  getUrlByCode(code) {
    const stmt = db.prepare('SELECT * FROM urls WHERE code = ?');
    const row = stmt.get(code);
    if (!row) return null;

    // Check expiration
    const isExpired = row.expires_at ? new Date(row.expires_at) < new Date() : false;

    return {
      ...row,
      is_active: Boolean(row.is_active),
      is_expired: isExpired
    };
  },

  // Record a click
  recordClick(code, { ip, browser, os, deviceType, referrer }) {
    const insertClick = db.prepare(`
      INSERT INTO clicks (url_code, timestamp, ip, browser, os, device_type, referrer)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const updateClicks = db.prepare(`
      UPDATE urls SET clicks = clicks + 1 WHERE code = ?
    `);

    const now = new Date().toISOString();
    insertClick.run(code, now, ip || 'Anonymous', browser || 'Unknown', os || 'Unknown', deviceType || 'Desktop', referrer || 'Direct / None');
    updateClicks.run(code);
  },

  // Get all URLs with optional search & filter
  getAllUrls({ search = '', filter = 'all' } = {}) {
    let query = 'SELECT * FROM urls';
    const params = [];

    const conditions = [];
    if (search && search.trim()) {
      conditions.push('(code LIKE ? OR original_url LIKE ? OR title LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY id DESC';

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);

    const now = new Date();
    const mapped = rows.map(row => {
      const isExpired = row.expires_at ? new Date(row.expires_at) < now : false;
      return {
        ...row,
        is_active: Boolean(row.is_active),
        is_expired: isExpired
      };
    });

    if (filter === 'active') {
      return mapped.filter(r => r.is_active && !r.is_expired);
    } else if (filter === 'expired') {
      return mapped.filter(r => r.is_expired);
    } else if (filter === 'paused') {
      return mapped.filter(r => !r.is_active);
    }

    return mapped;
  },

  // Get overall summary statistics
  getGlobalStats() {
    const totalLinksStmt = db.prepare('SELECT COUNT(*) as count FROM urls');
    const totalClicksStmt = db.prepare('SELECT COALESCE(SUM(clicks), 0) as count FROM urls');
    const activeLinksStmt = db.prepare('SELECT COUNT(*) as count FROM urls WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > ?)');

    const totalLinks = totalLinksStmt.get().count;
    const totalClicks = totalClicksStmt.get().count;
    const activeLinks = activeLinksStmt.get(new Date().toISOString()).count;

    return { totalLinks, totalClicks, activeLinks };
  },

  // Get detailed analytics for a single URL
  getUrlAnalytics(code) {
    const url = this.getUrlByCode(code);
    if (!url) return null;

    // Total clicks
    const clicksStmt = db.prepare('SELECT * FROM clicks WHERE url_code = ? ORDER BY id DESC');
    const clicks = clicksStmt.all(code);

    // Click counts by date (last 7 days / recorded days)
    const clicksByDate = {};
    const deviceBreakdown = {};
    const browserBreakdown = {};
    const osBreakdown = {};
    const referrerBreakdown = {};

    clicks.forEach(c => {
      const dateKey = c.timestamp.split('T')[0];
      clicksByDate[dateKey] = (clicksByDate[dateKey] || 0) + 1;

      const device = c.device_type || 'Desktop';
      deviceBreakdown[device] = (deviceBreakdown[device] || 0) + 1;

      const browser = c.browser || 'Other';
      browserBreakdown[browser] = (browserBreakdown[browser] || 0) + 1;

      const os = c.os || 'Other';
      osBreakdown[os] = (osBreakdown[os] || 0) + 1;

      const ref = c.referrer || 'Direct';
      referrerBreakdown[ref] = (referrerBreakdown[ref] || 0) + 1;
    });

    return {
      url,
      totalClicks: clicks.length,
      clicksByDate,
      deviceBreakdown,
      browserBreakdown,
      osBreakdown,
      referrerBreakdown,
      recentClicks: clicks.slice(0, 15)
    };
  },

  // Toggle active state
  toggleUrlActive(code) {
    const url = this.getUrlByCode(code);
    if (!url) return null;

    const newActive = url.is_active ? 0 : 1;
    const stmt = db.prepare('UPDATE urls SET is_active = ? WHERE code = ?');
    stmt.run(newActive, code);

    return this.getUrlByCode(code);
  },

  // Delete URL
  deleteUrl(code) {
    const delClicks = db.prepare('DELETE FROM clicks WHERE url_code = ?');
    delClicks.run(code);
    const delUrl = db.prepare('DELETE FROM urls WHERE code = ?');
    const result = delUrl.run(code);
    return result.changes > 0;
  }
};

module.exports = dbService;
