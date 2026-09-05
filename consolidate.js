const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const EXPORTS_DIR = path.join(__dirname, 'exports');

function consolidateAllLeads() {
  if (!fs.existsSync(EXPORTS_DIR)) {
    console.log('No exports directory found.');
    return [];
  }

  // Read all .xlsx files except previously generated master files
  const files = fs.readdirSync(EXPORTS_DIR)
    .filter(f => f.endsWith('.xlsx') && !f.startsWith('all_leads_master'));

  console.log(`Found ${files.length} export file(s) to process.`);

  const leadsMap = new Map();
  let totalRawCount = 0;

  for (const file of files) {
    const fullPath = path.join(EXPORTS_DIR, file);
    try {
      const workbook = xlsx.readFile(fullPath);
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) continue;

      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
      console.log(`- ${file}: ${rows.length} rows`);
      totalRawCount += rows.length;

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

        // Create deduplication key based on name, email, and phone
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
          continue; // skip completely empty rows
        }

        if (!leadsMap.has(dedupKey)) {
          leadsMap.set(dedupKey, {
            'Platform': platform,
            'Name / Company': name,
            'Primary Email': email,
            'All Emails': allEmails || email,
            'Phone': phone,
            'Website / Profile': website,
            'Address / Location': address,
            'Role / Category': category,
            'Rating': rating,
            'Review Count': reviewCount,
            'Google Maps URL': mapsUrl,
            'LinkedIn': linkedin,
            'Instagram': instagram,
            'Facebook': facebook,
            'Twitter/X': twitter,
            'Date Scraped': dateScraped || new Date().toISOString().split('T')[0]
          });
        } else {
          // Merge missing fields if existing lead has blanks
          const existing = leadsMap.get(dedupKey);
          if (!existing['Primary Email'] && email) existing['Primary Email'] = email;
          if (!existing['Phone'] && phone) existing['Phone'] = phone;
          if (!existing['Website / Profile'] && website) existing['Website / Profile'] = website;
          if (!existing['LinkedIn'] && linkedin) existing['LinkedIn'] = linkedin;
          if (!existing['Instagram'] && instagram) existing['Instagram'] = instagram;
          if (!existing['Facebook'] && facebook) existing['Facebook'] = facebook;
        }
      }
    } catch (err) {
      console.error(`Error reading ${file}:`, err.message);
    }
  }

  const consolidatedLeads = Array.from(leadsMap.values());
  console.log(`\n========================================`);
  console.log(`Total Leads across files: ${totalRawCount}`);
  console.log(`Unique Deduplicated Leads: ${consolidatedLeads.length}`);
  console.log(`========================================\n`);

  // Generate Excel (.xlsx)
  const worksheet = xlsx.utils.json_to_sheet(consolidatedLeads);
  worksheet['!cols'] = [
    { wch: 18 }, // Platform
    { wch: 32 }, // Name / Company
    { wch: 30 }, // Primary Email
    { wch: 38 }, // All Emails
    { wch: 20 }, // Phone
    { wch: 32 }, // Website / Profile
    { wch: 38 }, // Address / Location
    { wch: 22 }, // Role / Category
    { wch: 8 },  // Rating
    { wch: 12 }, // Review Count
    { wch: 35 }, // Google Maps URL
    { wch: 28 }, // LinkedIn
    { wch: 28 }, // Instagram
    { wch: 28 }, // Facebook
    { wch: 28 }, // Twitter/X
    { wch: 14 }  // Date Scraped
  ];

  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'All Leads Master');

  const xlsxPath = path.join(EXPORTS_DIR, 'all_leads_master.xlsx');
  xlsx.writeFile(workbook, xlsxPath);
  console.log(`✓ Master Excel file saved: ${xlsxPath}`);

  // Generate CSV
  const csvHeaders = Object.keys(consolidatedLeads[0] || {});
  const csvRows = consolidatedLeads.map(row =>
    csvHeaders.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(',')
  );
  const csvContent = '\uFEFF' + [csvHeaders.join(','), ...csvRows].join('\r\n');
  const csvPath = path.join(EXPORTS_DIR, 'all_leads_master.csv');
  fs.writeFileSync(csvPath, csvContent, 'utf8');
  console.log(`✓ Master CSV file saved: ${csvPath}`);

  return consolidatedLeads;
}

if (require.main === module) {
  consolidateAllLeads();
}

module.exports = { consolidateAllLeads };
