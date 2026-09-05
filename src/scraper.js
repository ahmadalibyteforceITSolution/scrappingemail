const EventEmitter = require('events');
const { scrapeGoogleMaps } = require('./googleMaps');
const { scrapeLinkedInLeads } = require('./linkedinScraper');
const { extractFromWebsite } = require('./emailExtractor');
const { saveExportFiles, saveMasterExportFiles } = require('./exporter');
const { sleep } = require('./utils');

class LeadScraper extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.aborted = false;
    this.currentJob = null;
    this.leads = [];
    this.stats = {
      totalFound: 0,
      processed: 0,
      emailsFound: 0,
      websitesFound: 0,
      phonesFound: 0
    };
    this.logs = [];
    this.exportFiles = null;
  }

  log(message, type = 'info') {
    const entry = {
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    };
    this.logs.push(entry);
    if (this.logs.length > 200) this.logs.shift();
    this.emit('log', entry);
  }

  getState() {
    return {
      isRunning: this.isRunning,
      job: this.currentJob,
      stats: this.stats,
      leads: this.leads,
      logs: this.logs.slice(-30),
      exportFiles: this.exportFiles
    };
  }

  stop() {
    if (this.isRunning) {
      this.aborted = true;
      this.log('Scraping cancellation requested by user...', 'warning');
    }
  }

  async run({ query, location, platform = 'both', emailProvider = 'all', maxResults = 20, linkedinAccount = {} }) {
    if (this.isRunning) {
      throw new Error('A scraping task is already running. Please wait or stop it first.');
    }

    this.isRunning = true;
    this.aborted = false;
    this.leads = [];
    this.logs = [];
    this.exportFiles = null;
    this.currentJob = {
      query,
      location,
      platform,
      emailProvider,
      maxResults,
      linkedinAccount,
      startedAt: new Date().toISOString()
    };
    this.stats = {
      totalFound: 0,
      processed: 0,
      emailsFound: 0,
      websitesFound: 0,
      phonesFound: 0
    };

    this.emit('start', this.currentJob);
    this.log(`Starting [${platform.toUpperCase()}] lead scraping for "${query}" in "${location}" (Goal: ${maxResults} leads)...`);

    try {
      if (platform === 'linkedin') {
        // LinkedIn pipeline (Account or Stealth Multi-Engine)
        await this.runLinkedInScrape({ query, location, emailProvider, maxResults, linkedinAccount });
      } else if (platform === 'both') {
        // Both Google Maps and LinkedIn
        const halfLimit = Math.ceil(maxResults / 2);
        this.log(`--- Part 1: Scraping Google Maps (${halfLimit} leads) ---`);
        await this.runGoogleMapsScrape({ query, location, maxResults: halfLimit });

        if (!this.aborted) {
          const remaining = maxResults - this.leads.length;
          const targetLinkedIn = Math.max(remaining, halfLimit);
          this.log(`--- Part 2: Scraping LinkedIn Leads & Emails (${targetLinkedIn} leads) ---`);
          await this.runLinkedInScrape({ query, location, emailProvider, maxResults: targetLinkedIn, linkedinAccount });
        }
      } else {
        // Standard Google Maps + Website Crawler pipeline
        await this.runGoogleMapsScrape({ query, location, maxResults });
      }

      // Final Step: Export to CSV & Excel
      this.finishJob(query, location);

    } catch (err) {
      this.log(`Fatal error during scrape: ${err.message}`, 'error');
      this.emit('error', err);
    } finally {
      this.isRunning = false;
      this.emit('finished', this.getState());
    }
  }

  async runGoogleMapsScrape({ query, location, maxResults }) {
    this.log('Phase 1: Searching and extracting business listings from Google Maps...');
    const rawBusinesses = await scrapeGoogleMaps({
      query,
      location,
      maxResults,
      onProgress: (prog) => {
        if (prog.message) this.log(prog.message);
        this.emit('progress', { stage: prog.stage, data: prog });
      },
      shouldStop: () => this.aborted
    });

    this.stats.totalFound += rawBusinesses.length;
    this.log(`Google Maps Search Complete: Found ${rawBusinesses.length} businesses.`);

    if (this.aborted) return;

    this.log('Phase 2: Crawling business websites for verified emails & social channels...');
    for (let i = 0; i < rawBusinesses.length; i++) {
      if (this.aborted) {
        this.log('Scraping was stopped by user during website extraction.', 'warning');
        break;
      }

      const business = rawBusinesses[i];
      this.stats.processed++;
      if (business.phone) this.stats.phonesFound++;

      if (business.website) {
        this.stats.websitesFound++;
        this.log(`[${i + 1}/${rawBusinesses.length}] Crawling website: ${business.website}...`);

        try {
          const webData = await extractFromWebsite(business.website);
          business.emails = webData.emails || [];
          business.primaryEmail = webData.primaryEmail || '';
          business.facebook = webData.facebook || '';
          business.instagram = webData.instagram || '';
          business.linkedin = webData.linkedin || '';
          business.twitter = webData.twitter || '';

          if (business.emails.length > 0) {
            this.stats.emailsFound += business.emails.length;
            this.log(`  ✓ Found ${business.emails.length} email(s): ${business.emails.join(', ')}`, 'success');
          } else {
            this.log(`  - No public email found on ${business.website}`);
          }
        } catch (err) {
          this.log(`  ! Error crawling website: ${err.message}`, 'error');
          business.emails = [];
          business.primaryEmail = '';
        }
      } else {
        this.log(`[${i + 1}/${rawBusinesses.length}] ${business.name} has no website listed.`);
        business.emails = [];
        business.primaryEmail = '';
      }

      business.source = 'Google Maps';
      this.leads.push(business);
      this.emit('lead_added', business);

      await sleep(400);
    }
  }

  async runLinkedInScrape({ query, location, emailProvider, maxResults, linkedinAccount = {} }) {
    this.log(`Phase: Searching LinkedIn profiles & direct emails for "${query}" in "${location}"...`);

    const linkedInLeads = await scrapeLinkedInLeads({
      query,
      location,
      emailProvider,
      maxResults,
      linkedinAccount,
      onProgress: (prog) => {
        if (prog.message) this.log(prog.message);
        if (prog.lead) {
          this.stats.totalFound++;
          this.stats.processed++;
          if (prog.lead.primaryEmail) this.stats.emailsFound++;
          if (prog.lead.phone) this.stats.phonesFound++;
          this.leads.push(prog.lead);
          this.emit('lead_added', prog.lead);
        }
        this.emit('progress', { stage: prog.stage, data: prog });
      },
      shouldStop: () => this.aborted
    });

    this.log(`LinkedIn Phase Complete: Found ${linkedInLeads.length} leads.`, 'success');
  }

  finishJob(query, location) {
    if (this.leads.length > 0) {
      this.log('Phase 3: Formatting and generating CSV & Excel download files...');
      try {
        const saved = saveExportFiles(this.leads, query, location);
        this.exportFiles = saved;
        this.log(`✓ Files saved to exports/ folder:`, 'success');
        this.log(`  - CSV: ${saved.csvFileName}`, 'success');
        this.log(`  - Excel: ${saved.xlsxFileName}`, 'success');

        // Automatically update master aggregated database
        saveMasterExportFiles();
        this.emit('files_ready', saved);
      } catch (err) {
        this.log(`Failed to save export files: ${err.message}`, 'error');
      }
    } else {
      this.log('No leads were extracted to export.', 'warning');
    }
  }
}

const globalScraper = new LeadScraper();

module.exports = {
  LeadScraper,
  globalScraper
};
