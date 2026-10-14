const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const { UAParser } = require('ua-parser-js');
const dbService = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, '..', 'public')));

// URL Validation helper
function normalizeAndValidateUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { valid: false, error: 'URL cannot be empty' };
  }

  let trimmed = inputUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = 'https://' + trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Only HTTP and HTTPS URLs are supported' };
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return { valid: false, error: 'Invalid domain name format' };
    }
    return { valid: true, url: parsed.toString() };
  } catch (err) {
    return { valid: false, error: 'Invalid URL format' };
  }
}

// Helper to determine base URL
function getBaseUrl(req) {
  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}

// ----------------- API ROUTES -----------------

// Global summary stats
app.get('/api/stats/global', (req, res) => {
  try {
    const stats = dbService.getGlobalStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check custom code availability
app.get('/api/check-code/:code', (req, res) => {
  try {
    const { code } = req.params;
    const isAvailable = dbService.isCodeAvailable(code);
    res.json({ success: true, code, available: isAvailable });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Shorten a URL
app.post('/api/shorten', (req, res) => {
  try {
    const { originalUrl, customCode, title, expiresInHours } = req.body;

    const validated = normalizeAndValidateUrl(originalUrl);
    if (!validated.valid) {
      return res.status(400).json({ success: false, error: validated.error });
    }

    const shortUrl = dbService.createShortUrl({
      originalUrl: validated.url,
      customCode,
      title: title ? title.trim() : null,
      expiresInHours
    });

    const baseUrl = getBaseUrl(req);
    res.status(201).json({
      success: true,
      data: {
        ...shortUrl,
        short_url: `${baseUrl}/${shortUrl.code}`
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get all links
app.get('/api/links', (req, res) => {
  try {
    const { search, filter } = req.query;
    const links = dbService.getAllUrls({ search, filter });
    const baseUrl = getBaseUrl(req);

    const enriched = links.map(link => ({
      ...link,
      short_url: `${baseUrl}/${link.code}`
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single link analytics
app.get('/api/analytics/:code', (req, res) => {
  try {
    const { code } = req.params;
    const analytics = dbService.getUrlAnalytics(code);

    if (!analytics) {
      return res.status(404).json({ success: false, error: 'Short link not found' });
    }

    const baseUrl = getBaseUrl(req);
    analytics.url.short_url = `${baseUrl}/${analytics.url.code}`;

    res.json({ success: true, data: analytics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate QR Code data URL or SVG
app.get('/api/qr/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const url = dbService.getUrlByCode(code);
    if (!url) {
      return res.status(404).json({ success: false, error: 'Short link not found' });
    }

    const baseUrl = getBaseUrl(req);
    const destination = `${baseUrl}/${code}`;

    const qrDataUrl = await QRCode.toDataURL(destination, {
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    res.json({ success: true, qr: qrDataUrl, destination });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle link active/paused
app.patch('/api/links/:code/toggle', (req, res) => {
  try {
    const { code } = req.params;
    const updated = dbService.toggleUrlActive(code);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Short link not found' });
    }

    const baseUrl = getBaseUrl(req);
    res.json({
      success: true,
      data: {
        ...updated,
        short_url: `${baseUrl}/${updated.code}`
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete link
app.delete('/api/links/:code', (req, res) => {
  try {
    const { code } = req.params;
    const deleted = dbService.deleteUrl(code);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Short link not found' });
    }
    res.json({ success: true, message: 'Link deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------- REDIRECTION HANDLER -----------------

// Friendly styled notice page for expired/paused/not-found URLs
function renderNoticePage(title, message, code, badgeText, badgeColor) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} | VeloURL</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background-color: #090A0F;
          color: #E2E8F0;
          font-family: 'Plus Jakarta Sans', sans-serif;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background-image: radial-gradient(circle at 50% 0%, rgba(245, 158, 11, 0.12), transparent 50%);
        }
        .card {
          background: rgba(19, 23, 32, 0.9);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          padding: 40px;
          max-width: 480px;
          width: 100%;
          text-align: center;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(12px);
        }
        .badge {
          display: inline-block;
          padding: 6px 14px;
          border-radius: 9999px;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 20px;
          background: ${badgeColor === 'crimson' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)'};
          color: ${badgeColor === 'crimson' ? '#F87171' : '#FBBF24'};
          border: 1px solid ${badgeColor === 'crimson' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)'};
        }
        h1 {
          font-family: 'Outfit', sans-serif;
          font-size: 28px;
          font-weight: 800;
          color: #FFFFFF;
          margin-bottom: 12px;
        }
        p {
          color: #94A3B8;
          font-size: 15px;
          line-height: 1.6;
          margin-bottom: 28px;
        }
        .code-box {
          background: rgba(9, 10, 15, 0.8);
          border: 1px dashed rgba(255, 255, 255, 0.12);
          border-radius: 10px;
          padding: 10px 16px;
          font-family: monospace;
          color: #F59E0B;
          margin-bottom: 28px;
          word-break: break-all;
        }
        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: #F59E0B;
          color: #090A0F;
          font-weight: 700;
          font-size: 14px;
          padding: 12px 24px;
          border-radius: 12px;
          text-decoration: none;
          transition: all 0.2s ease;
        }
        .btn:hover {
          background: #D97706;
          transform: translateY(-2px);
          box-shadow: 0 10px 20px -5px rgba(245, 158, 11, 0.3);
        }
      </style>
    </head>
    <body>
      <div class="card">
        <span class="badge">${badgeText}</span>
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="code-box">Path: /${code || 'unknown'}</div>
        <a href="/" class="btn">
          Back to Homepage
        </a>
      </div>
    </body>
    </html>
  `;
}

app.get('/:code', (req, res, next) => {
  const { code } = req.params;

  // Skip favicon or special files
  if (code === 'favicon.ico' || code.startsWith('api') || code.includes('.')) {
    return next();
  }

  const urlRecord = dbService.getUrlByCode(code);

  if (!urlRecord) {
    return res.status(404).send(renderNoticePage(
      'Short Link Not Found',
      'The short URL you requested does not exist or may have been deleted by the owner.',
      code,
      '404 Not Found',
      'crimson'
    ));
  }

  if (urlRecord.is_expired) {
    return res.status(410).send(renderNoticePage(
      'Link Expired',
      'This link had an expiration limit set by the creator and is no longer accessible.',
      code,
      'Expired',
      'amber'
    ));
  }

  if (!urlRecord.is_active) {
    return res.status(403).send(renderNoticePage(
      'Link Paused',
      'This shortened link has been temporarily deactivated or paused by its creator.',
      code,
      'Deactivated',
      'amber'
    ));
  }

  // Parse client user agent
  const rawUA = req.get('user-agent') || '';
  const parser = new UAParser(rawUA);
  const uaResult = parser.getResult();

  const browser = uaResult.browser.name || 'Unknown Browser';
  const os = uaResult.os.name || 'Unknown OS';
  let deviceType = uaResult.device.type || 'Desktop';
  if (deviceType) {
    deviceType = deviceType.charAt(0).toUpperCase() + deviceType.slice(1);
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Anonymous';
  let referrer = req.get('referrer') || req.get('referer') || 'Direct';
  try {
    if (referrer && referrer !== 'Direct') {
      const refHost = new URL(referrer).hostname;
      referrer = refHost;
    }
  } catch (e) {
    // keep as is
  }

  // Record click asynchronously
  try {
    dbService.recordClick(code, {
      ip,
      browser,
      os,
      deviceType,
      referrer
    });
  } catch (err) {
    console.error('Failed to log click:', err);
  }

  // Perform standard 302 HTTP redirection
  return res.redirect(302, urlRecord.original_url);
});

// Update package.json scripts and start server
app.listen(PORT, () => {
  console.log(`VeloURL Server running at http://localhost:${PORT}`);
});
