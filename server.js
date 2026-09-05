const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { globalScraper } = require('./src/scraper');
const { generateCSV, generateExcelBuffer, getAllCombinedLeads, saveMasterExportFiles, EXPORTS_DIR } = require('./src/exporter');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const router = express.Router();

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: process.env.VERCEL ? 'vercel-serverless' : 'standard-node',
    uptime: process.uptime()
  });
});

// API: Start Scraping Job
router.post('/scrape/start', (req, res) => {
  const { query, location, platform = 'both', emailProvider = 'all', maxResults = 20, linkedinAccount = {} } = req.body;

  if (!query || !location) {
    return res.status(400).json({
      error: 'Please provide both search term (niche/role) and location/area.'
    });
  }

  if (globalScraper.isRunning) {
    return res.status(409).json({
      error: 'A scrape task is currently in progress. Stop it or wait for completion.'
    });
  }

  const limit = Math.min(Math.max(parseInt(maxResults, 10) || 20, 1), 500);

  // Run in background
  globalScraper.run({
    query: query.trim(),
    location: location.trim(),
    platform,
    emailProvider,
    maxResults: limit,
    linkedinAccount
  }).catch(err => {
    console.error('Scraper task error:', err);
  });

  res.json({
    success: true,
    message: `Scraper started on [${platform.toUpperCase()}] for "${query}" in "${location}" (Target: ${limit} leads).`
  });
});

// API: Check Scraping Status & Live Leads
router.get('/scrape/status', (req, res) => {
  res.json(globalScraper.getState());
});

// API: Stop Current Scraping Job
router.post('/scrape/stop', (req, res) => {
  if (!globalScraper.isRunning) {
    return res.json({ success: true, message: 'Scraper is not running.' });
  }
  globalScraper.stop();
  res.json({ success: true, message: 'Stopping scraper...' });
});

// API: Direct Download of current results
router.get('/download/:format', (req, res) => {
  const format = req.params.format.toLowerCase();
  const leads = globalScraper.leads || [];

  if (leads.length === 0) {
    return res.status(404).send('No leads available to download yet. Run a scraper first.');
  }

  const querySlug = (globalScraper.currentJob?.query || 'leads').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const locationSlug = (globalScraper.currentJob?.location || 'area').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const timestamp = new Date().toISOString().slice(0, 10);

  if (format === 'csv') {
    const csvData = generateCSV(leads);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads_${querySlug}_${locationSlug}_${timestamp}.csv"`);
    return res.send(csvData);
  }

  if (format === 'excel' || format === 'xlsx') {
    const excelBuffer = generateExcelBuffer(leads);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="leads_${querySlug}_${locationSlug}_${timestamp}.xlsx"`);
    return res.send(excelBuffer);
  }

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="leads_${querySlug}_${locationSlug}_${timestamp}.json"`);
    return res.json(leads);
  }

  res.status(400).send('Invalid download format. Use csv, excel, or json.');
});

// Helper to list export files from exports directory
function getExportFilesList() {
  const filesList = [];
  const checkedDirs = [EXPORTS_DIR];
  const localExports = path.join(__dirname, 'exports');
  if (EXPORTS_DIR !== localExports && fs.existsSync(localExports)) {
    checkedDirs.push(localExports);
  }

  const seen = new Set();
  for (const dir of checkedDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.csv') || f.endsWith('.xlsx'))
        .filter(f => !seen.has(f));

      for (const name of files) {
        seen.add(name);
        try {
          const stats = fs.statSync(path.join(dir, name));
          filesList.push({
            name,
            size: (stats.size / 1024).toFixed(1) + ' KB',
            date: stats.mtime.toLocaleString(),
            _mtime: stats.mtime.getTime()
          });
        } catch (e) {}
      }
    } catch (e) {}
  }

  return filesList.sort((a, b) => b._mtime - a._mtime);
}

// API: List past export files
router.get('/exports', (req, res) => {
  res.json(getExportFilesList());
});

// API: Download specific file from exports/
router.get('/exports/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename);
  let filePath = path.join(EXPORTS_DIR, safeName);

  if (!fs.existsSync(filePath)) {
    const fallbackPath = path.join(__dirname, 'exports', safeName);
    if (fs.existsSync(fallbackPath)) {
      filePath = fallbackPath;
    } else {
      return res.status(404).send('File not found');
    }
  }

  res.download(filePath);
});

// API: Download all leads combined into one master file
router.get('/exports-all/:format', (req, res) => {
  const format = (req.params.format || 'excel').toLowerCase();
  const leads = getAllCombinedLeads();

  if (!leads || leads.length === 0) {
    return res.status(404).send('No saved leads found in exports folder. Run a scrape task first.');
  }

  const timestamp = new Date().toISOString().slice(0, 10);

  if (format === 'csv') {
    const csvData = generateCSV(leads);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="all_extracted_leads_master_${timestamp}.csv"`);
    return res.send(csvData);
  }

  if (format === 'excel' || format === 'xlsx') {
    const excelBuffer = generateExcelBuffer(leads);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="all_extracted_leads_master_${timestamp}.xlsx"`);
    return res.send(excelBuffer);
  }

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="all_extracted_leads_master_${timestamp}.json"`);
    return res.json(leads);
  }

  res.status(400).send('Invalid download format. Use csv, excel, or json.');
});

// Mount router on both '/api' and '/' for serverless / rewrites flexibility
app.use('/api', router);
app.use('/', router);

function startServer(portToTry) {
  const server = app.listen(portToTry, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(` LeadHarvest Pro: Email Scraper Server Running!`);
    console.log(` Dashboard URL: http://localhost:${portToTry}`);
    console.log(`====================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${portToTry} is already in use. Trying port ${portToTry + 1}...`);
      startServer(portToTry + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

// Start listener only when running standalone, not when required by Vercel serverless function
if (require.main === module) {
  startServer(PORT);
}

module.exports = app;
