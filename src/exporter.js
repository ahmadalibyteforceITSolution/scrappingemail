const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const EXPORTS_DIR = process.env.VERCEL
  ? path.join('/tmp', 'exports')
  : path.join(__dirname, '..', 'exports');

function ensureExportsDir() {
  if (!fs.existsSync(EXPORTS_DIR)) {
    try {
      fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    } catch (e) {
      console.warn('Could not create exports directory:', e.message);
    }
  }
}

function sanitizeFilename(str) {
  return str.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
}

function formatLeadsForExport(leads) {
  return leads.map(lead => ({
    'Platform': lead.source || 'Google Maps',
    'Name / Company': lead.name || '',
    'Primary Email': lead.primaryEmail || (lead.emails && lead.emails[0]) || '',
    'All Emails': lead.emails ? lead.emails.join(', ') : '',
    'Phone': lead.phone || '',
    'Website / Profile': lead.website || '',
    'Address / Location': lead.address || lead.location || '',
    'Role / Category': lead.category || '',
    'Rating': lead.rating || '',
    'Review Count': lead.reviewsCount || '',
    'Google Maps URL': lead.mapsUrl || '',
    'LinkedIn': lead.linkedin || '',
    'Instagram': lead.instagram || '',
    'Facebook': lead.facebook || '',
    'Twitter/X': lead.twitter || '',
    'Date Scraped': lead.dateScraped || new Date().toISOString().split('T')[0]
  }));
}

function generateCSV(leads) {
  const formatted = formatLeadsForExport(leads);
  if (formatted.length === 0) return '\uFEFFBusiness Name,Primary Email,All Emails,Phone,Website,Address,Category,Rating,Review Count,Google Maps URL,LinkedIn,Instagram,Facebook,Twitter/X,Date Scraped\n';

  const headers = Object.keys(formatted[0]);
  const rows = formatted.map(row => {
    return headers.map(header => {
      const val = (row[header] || '').toString().replace(/"/g, '""');
      return `"${val}"`;
    }).join(',');
  });

  // Include UTF-8 BOM so Excel opens it with correct formatting
  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
}

function generateExcelBuffer(leads) {
  const formatted = formatLeadsForExport(leads);
  const worksheet = xlsx.utils.json_to_sheet(formatted);

  // Auto-fit column widths
  const colWidths = [
    { wch: 28 }, // Business Name
    { wch: 28 }, // Primary Email
    { wch: 35 }, // All Emails
    { wch: 18 }, // Phone
    { wch: 30 }, // Website
    { wch: 35 }, // Address
    { wch: 20 }, // Category
    { wch: 8 },  // Rating
    { wch: 12 }, // Review Count
    { wch: 35 }, // Google Maps URL
    { wch: 25 }, // LinkedIn
    { wch: 25 }, // Instagram
    { wch: 25 }, // Facebook
    { wch: 25 }, // Twitter
    { wch: 15 }  // Date Scraped
  ];
  worksheet['!cols'] = colWidths;

  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Leads');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function saveExportFiles(leads, query = 'leads', location = 'area') {
  ensureExportsDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseName = `leads_${sanitizeFilename(query)}_${sanitizeFilename(location)}_${timestamp}`;

  const csvContent = generateCSV(leads);
  const csvPath = path.join(EXPORTS_DIR, `${baseName}.csv`);
  fs.writeFileSync(csvPath, csvContent, 'utf8');

  const xlsxBuffer = generateExcelBuffer(leads);
  const xlsxPath = path.join(EXPORTS_DIR, `${baseName}.xlsx`);
  fs.writeFileSync(xlsxPath, xlsxBuffer);

  return {
    baseName,
    csvPath,
    xlsxPath,
    csvFileName: `${baseName}.csv`,
    xlsxFileName: `${baseName}.xlsx`
  };
}

function getAllCombinedLeads() {
  ensureExportsDir();
  let files = [];
  try {
    if (fs.existsSync(EXPORTS_DIR)) {
      files = fs.readdirSync(EXPORTS_DIR)
        .filter(f => f.endsWith('.xlsx') && !f.startsWith('all_leads_master'))
        .map(f => path.join(EXPORTS_DIR, f));
    }
  } catch (e) {}

  const bundledDir = path.join(__dirname, '..', 'exports');
  if (files.length === 0 && fs.existsSync(bundledDir) && bundledDir !== EXPORTS_DIR) {
    try {
      files = fs.readdirSync(bundledDir)
        .filter(f => f.endsWith('.xlsx') && !f.startsWith('all_leads_master'))
        .map(f => path.join(bundledDir, f));
    } catch (e) {}
  }

  const leadsMap = new Map();

  for (const fullPath of files) {
    try {
      const workbook = xlsx.readFile(fullPath);
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) continue;

      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

      for (const row of rows) {
        const name = String(row['Name / Company'] || row['Business Name'] || '').trim();
        const email = String(row['Primary Email'] || '').trim();
        const allEmails = String(row['All Emails'] || '').trim();
        const phone = String(row['Phone'] || '').trim();
        const website = String(row['Website / Profile'] || row['Website'] || '').trim();
        const address = String(row['Address / Location'] || row['Address'] || '').trim();
        const category = String(row['Role / Category'] || row['Category'] || '').trim();
        const platform = String(row['Platform'] || (file.includes('ceo') ? 'LinkedIn / Google' : 'Google Maps')).trim();
        const rating = String(row['Rating'] || '').trim();
        const reviewCount = String(row['Review Count'] || '').trim();
        const mapsUrl = String(row['Google Maps URL'] || '').trim();
        const linkedin = String(row['LinkedIn'] || '').trim();
        const instagram = String(row['Instagram'] || '').trim();
        const facebook = String(row['Facebook'] || '').trim();
        const twitter = String(row['Twitter/X'] || row['Twitter'] || '').trim();
        const dateScraped = String(row['Date Scraped'] || '').trim();

        const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanEmail = email.toLowerCase();
        const cleanPhone = phone.replace(/[^0-9]/g, '');

        let dedupKey = '';
        if (cleanEmail) {
          dedupKey = `email:${cleanEmail}`;
        } else if (cleanName && cleanPhone) {
          dedupKey = `name_phone:${cleanName}_${cleanPhone}`;
        } else if (cleanName && website) {
          dedupKey = `name_web:${cleanName}_${website.toLowerCase()}`;
        } else if (cleanName) {
          dedupKey = `name:${cleanName}`;
        } else {
          continue;
        }

        if (!leadsMap.has(dedupKey)) {
          leadsMap.set(dedupKey, {
            source: platform,
            name,
            primaryEmail: email,
            emails: allEmails ? allEmails.split(',').map(s => s.trim()).filter(Boolean) : (email ? [email] : []),
            phone,
            website,
            address,
            location: address,
            category,
            rating,
            reviewsCount: reviewCount,
            mapsUrl,
            linkedin,
            instagram,
            facebook,
            twitter,
            dateScraped: dateScraped || new Date().toISOString().split('T')[0]
          });
        } else {
          const existing = leadsMap.get(dedupKey);
          if (!existing.primaryEmail && email) {
            existing.primaryEmail = email;
            if (!existing.emails.includes(email)) existing.emails.push(email);
          }
          if (!existing.phone && phone) existing.phone = phone;
          if (!existing.website && website) existing.website = website;
          if (!existing.linkedin && linkedin) existing.linkedin = linkedin;
          if (!existing.instagram && instagram) existing.instagram = instagram;
          if (!existing.facebook && facebook) existing.facebook = facebook;
        }
      }
    } catch (err) {
      console.error(`Error reading ${file}:`, err.message);
    }
  }

  return Array.from(leadsMap.values());
}

function saveMasterExportFiles() {
  const leads = getAllCombinedLeads();
  if (leads.length === 0) return null;

  ensureExportsDir();
  const csvContent = generateCSV(leads);
  const csvPath = path.join(EXPORTS_DIR, 'all_leads_master.csv');
  fs.writeFileSync(csvPath, csvContent, 'utf8');

  const xlsxBuffer = generateExcelBuffer(leads);
  const xlsxPath = path.join(EXPORTS_DIR, 'all_leads_master.xlsx');
  fs.writeFileSync(xlsxPath, xlsxBuffer);

  return {
    totalLeads: leads.length,
    csvPath,
    xlsxPath,
    csvFileName: 'all_leads_master.csv',
    xlsxFileName: 'all_leads_master.xlsx'
  };
}

module.exports = {
  formatLeadsForExport,
  generateCSV,
  generateExcelBuffer,
  saveExportFiles,
  getAllCombinedLeads,
  saveMasterExportFiles,
  EXPORTS_DIR
};
