const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { findChromePath, sleep, randomSleep, cleanText } = require('./utils');
const { extractEmailsFromText } = require('./emailExtractor');

puppeteer.use(StealthPlugin());

/**
 * Scrapes LinkedIn profiles & emails either via LinkedIn Account session or Public Multi-Engine Stealth search.
 * @param {Object} options
 * @param {string} options.query - Job title, niche or role (e.g. "CEO", "Real Estate", "Dentist")
 * @param {string} options.location - Target city/location
 * @param {string} [options.emailProvider] - Target email domain ("all", "gmail.com", etc.)
 * @param {number} [options.maxResults] - Max leads to collect
 * @param {Object} [options.linkedinAccount] - Account settings { mode: 'stealth'|'account', email, password, liAt }
 * @param {Function} [options.onProgress] - Progress callback
 * @param {Function} [options.shouldStop] - Abort check callback
 */
async function scrapeLinkedInLeads({
  query,
  location,
  emailProvider = 'all',
  maxResults = 20,
  linkedinAccount = {},
  onProgress = () => {},
  shouldStop = () => false
}) {
  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error('Google Chrome or Microsoft Edge was not found on your system.');
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
      '--lang=en-US,en'
    ]
  });

  const leads = [];
  const seenProfiles = new Set();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    );

    // Block unnecessary media
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'media', 'font'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const isAccountMode = linkedinAccount && linkedinAccount.mode === 'account' && (linkedinAccount.liAt || (linkedinAccount.email && linkedinAccount.password));

    if (isAccountMode) {
      onProgress({ stage: 'linkedin_auth', message: 'Authenticating with LinkedIn Account...' });
      const loggedIn = await handleLinkedInAuth(page, linkedinAccount, onProgress);

      if (loggedIn) {
        onProgress({ stage: 'linkedin_account_search', message: `Connected to LinkedIn! Searching directly for "${query}" in "${location}"...` });
        await scrapeDirectLinkedInSearch(page, {
          query,
          location,
          maxResults,
          leads,
          seenProfiles,
          onProgress,
          shouldStop
        });
      } else {
        onProgress({ stage: 'linkedin_auth_warning', message: 'LinkedIn direct login encountered a checkpoint or failed. Switching to Stealth Multi-Engine Search...' });
        await scrapeStealthEngines(page, {
          query,
          location,
          emailProvider,
          maxResults,
          leads,
          seenProfiles,
          onProgress,
          shouldStop
        });
      }
    } else {
      // Default: Public Multi-Engine Search (Google + Bing + DuckDuckGo)
      await scrapeStealthEngines(page, {
        query,
        location,
        emailProvider,
        maxResults,
        leads,
        seenProfiles,
        onProgress,
        shouldStop
      });
    }

    onProgress({
      stage: 'completed',
      message: `LinkedIn extraction complete: Discovered ${leads.length} profiles & verified contacts.`
    });

  } catch (error) {
    onProgress({ stage: 'error', message: `LinkedIn scraper error: ${error.message}` });
  } finally {
    await browser.close().catch(() => {});
  }

  return leads;
}

/**
 * Handle LinkedIn account login via li_at cookie or credentials
 */
async function handleLinkedInAuth(page, account, onProgress) {
  try {
    // 1. Prioritize li_at session cookie (instant & avoids CAPTCHA)
    if (account.liAt) {
      const cleanCookie = account.liAt.trim();
      onProgress({ stage: 'linkedin_cookie', message: 'Applying LinkedIn li_at session cookie...' });
      await page.setCookie({
        name: 'li_at',
        value: cleanCookie,
        domain: '.linkedin.com',
        path: '/',
        httpOnly: true,
        secure: true
      });

      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 25000 });
      await sleep(2000);

      const isFeed = await page.evaluate(() => {
        return !!(document.querySelector('.feed-identity-module') || document.querySelector('#global-nav') || document.querySelector('.global-nav'));
      });

      if (isFeed) {
        onProgress({ stage: 'linkedin_cookie_ok', message: '✓ Successfully authenticated via LinkedIn session cookie!' });
        return true;
      }
    }

    // 2. Email & Password login
    if (account.email && account.password) {
      onProgress({ stage: 'linkedin_login_form', message: `Logging in to LinkedIn as ${account.email}...` });
      await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 25000 });
      await sleep(1500);

      const usernameInput = await page.$('#username');
      const passwordInput = await page.$('#password');
      if (usernameInput && passwordInput) {
        await page.type('#username', account.email, { delay: 40 });
        await page.type('#password', account.password, { delay: 40 });
        await page.click('button[type="submit"]');

        try {
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
        } catch (e) {}

        await sleep(2000);

        const currentUrl = page.url();
        if (currentUrl.includes('/feed') || currentUrl.includes('/checkpoint/challenge') === false) {
          const hasNav = await page.evaluate(() => !!document.querySelector('#global-nav, .global-nav'));
          if (hasNav) {
            onProgress({ stage: 'linkedin_login_ok', message: '✓ Successfully logged in to LinkedIn!' });
            return true;
          }
        }

        if (currentUrl.includes('/checkpoint/')) {
          onProgress({ stage: 'linkedin_checkpoint', message: 'LinkedIn requires 2FA or security verification. Switching to stealth public search.' });
          return false;
        }
      }
    }
  } catch (err) {
    onProgress({ stage: 'linkedin_auth_err', message: `LinkedIn auth attempt failed: ${err.message}` });
  }

  return false;
}

/**
 * Scrapes directly within LinkedIn when logged in
 */
async function scrapeDirectLinkedInSearch(page, { query, location, maxResults, leads, seenProfiles, onProgress, shouldStop }) {
  const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query + ' ' + location)}&origin=GLOBAL_SEARCH_HEADER`;
  onProgress({ stage: 'linkedin_searching', message: `Navigating to LinkedIn Search: ${query} ${location}...` });

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  let pageNum = 1;
  const maxPages = Math.ceil(maxResults / 10) + 1;

  while (leads.length < maxResults && pageNum <= maxPages) {
    if (shouldStop()) break;

    // Scroll down to load all items on page
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await sleep(1000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1500);

    const members = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('li.reusable-search__result-container, div.entity-result');

      cards.forEach(card => {
        const titleLink = card.querySelector('a.app-aware-link[href*="/in/"]');
        if (!titleLink) return;

        const href = titleLink.href || '';
        const nameEl = titleLink.querySelector('span[aria-hidden="true"]') || titleLink;
        const name = nameEl ? nameEl.textContent.trim() : '';

        const headlineEl = card.querySelector('.entity-result__primary-subtitle, div.linked-area .t-14');
        const headline = headlineEl ? headlineEl.textContent.trim() : '';

        const locEl = card.querySelector('.entity-result__secondary-subtitle, div.linked-area .t-normal');
        const memberLoc = locEl ? locEl.textContent.trim() : '';

        const summaryEl = card.querySelector('.entity-result__summary');
        const summary = summaryEl ? summaryEl.textContent.trim() : '';

        if (name && href) {
          results.push({ href, name, headline, location: memberLoc, summary });
        }
      });

      return results;
    });

    onProgress({ stage: 'linkedin_page_found', message: `Found ${members.length} members on LinkedIn page ${pageNum}...` });

    for (const member of members) {
      if (leads.length >= maxResults || shouldStop()) break;

      let cleanUrl = member.href.split('?')[0];
      if (seenProfiles.has(cleanUrl)) continue;
      seenProfiles.add(cleanUrl);

      // Extract emails from headline or summary
      const textToScan = `${member.name} ${member.headline} ${member.summary}`;
      const foundEmails = extractEmailsFromText(textToScan);

      const lead = {
        name: cleanText(member.name) || 'LinkedIn Member',
        primaryEmail: foundEmails[0] || '',
        emails: foundEmails,
        phone: '',
        website: cleanUrl,
        linkedin: cleanUrl,
        category: cleanText(member.headline) || query,
        address: cleanText(member.location) || location,
        location: cleanText(member.location) || location,
        rating: '',
        reviewsCount: '',
        mapsUrl: '',
        dateScraped: new Date().toISOString().split('T')[0],
        source: 'LinkedIn'
      };

      leads.push(lead);
      onProgress({
        stage: 'lead_found',
        lead,
        currentCount: leads.length,
        total: maxResults,
        message: `✓ [LinkedIn Account] ${lead.name} - ${lead.category}`
      });

      await sleep(300);
    }

    if (leads.length >= maxResults) break;

    // Next page on LinkedIn
    const hasNext = await page.evaluate(() => {
      const nextBtn = document.querySelector('button[aria-label="Next"], button.artdeco-pagination__button--next');
      if (nextBtn && !nextBtn.disabled) {
        nextBtn.click();
        return true;
      }
      return false;
    });

    if (hasNext) {
      pageNum++;
      await sleep(3000);
    } else {
      break;
    }
  }
}

/**
 * Public Multi-Engine Search (Google + Bing + DuckDuckGo)
 */
async function scrapeStealthEngines(page, { query, location, emailProvider, maxResults, leads, seenProfiles, onProgress, shouldStop }) {
  let emailTerm = '';
  if (!emailProvider || emailProvider === 'all' || emailProvider === 'any') {
    emailTerm = '("@gmail.com" OR "@yahoo.com" OR "@outlook.com" OR "@hotmail.com" OR "email" OR "contact")';
  } else {
    emailTerm = `"@${emailProvider}"`;
  }

  // Engine 1: Google Search
  onProgress({ stage: 'google_xray', message: `Harvesting LinkedIn leads via Google Search for "${query}" in "${location}"...` });
  await scrapeGoogleSearch(page, { query, location, emailTerm, maxResults, leads, seenProfiles, onProgress, shouldStop });

  if (leads.length >= maxResults || shouldStop()) return;

  // Engine 2: Bing Search
  onProgress({ stage: 'bing_xray', message: `Expanding LinkedIn search via Bing for "${query}" in "${location}" (${leads.length}/${maxResults} leads found)...` });
  await scrapeBingSearch(page, { query, location, emailTerm, maxResults, leads, seenProfiles, onProgress, shouldStop });

  if (leads.length >= maxResults || shouldStop()) return;

  // Engine 3: DuckDuckGo
  onProgress({ stage: 'duckduckgo_xray', message: `Expanding search via DuckDuckGo (${leads.length}/${maxResults} leads found)...` });
  await scrapeDuckDuckGo(page, { query, location, emailTerm, maxResults, leads, seenProfiles, onProgress, shouldStop });
}

async function scrapeGoogleSearch(page, { query, location, emailTerm, maxResults, leads, seenProfiles, onProgress, shouldStop }) {
  try {
    const q = `site:linkedin.com/in "${query}" "${location}" ${emailTerm}`.trim();
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=30&hl=en`;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2000);

    // Check for Google consent
    try {
      const btn = await page.$('button#L2AGLb, button:has-text("Accept all"), form[action*="consent"] button');
      if (btn) await btn.click();
    } catch (e) {}

    const results = await page.evaluate(() => {
      const items = [];
      const blocks = document.querySelectorAll('div.g, div.tF2Cxc, div.MjjYud');

      blocks.forEach(b => {
        const a = b.querySelector('a[href*="linkedin.com/in/"]');
        if (!a) return;

        const h3 = b.querySelector('h3');
        const title = h3 ? h3.textContent.trim() : '';
        const snippetEl = b.querySelector('div[data-sncf], div.VwiC3b, div.IsZvec, span.aCOpRe');
        const snippet = snippetEl ? snippetEl.textContent.trim() : b.innerText;

        if (title && a.href) {
          items.push({ href: a.href, title, snippet });
        }
      });

      return items;
    });

    for (const item of results) {
      if (leads.length >= maxResults || shouldStop()) break;
      processSearchSnippet(item, query, location, leads, seenProfiles, onProgress, maxResults);
    }
  } catch (err) {
    onProgress({ stage: 'google_xray_err', message: `Google search notice: ${err.message}` });
  }
}

async function scrapeBingSearch(page, { query, location, emailTerm, maxResults, leads, seenProfiles, onProgress, shouldStop }) {
  try {
    const q = `site:linkedin.com/in "${query}" "${location}" ${emailTerm}`.trim();
    const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=30`;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2000);

    const results = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll('li.b_algo');

      cards.forEach(c => {
        const a = c.querySelector('a[href*="linkedin.com/in/"]');
        if (!a) return;

        const h2 = c.querySelector('h2');
        const title = h2 ? h2.textContent.trim() : '';
        const p = c.querySelector('div.b_caption p, p');
        const snippet = p ? p.textContent.trim() : c.innerText;

        if (title && a.href) {
          items.push({ href: a.href, title, snippet });
        }
      });

      return items;
    });

    for (const item of results) {
      if (leads.length >= maxResults || shouldStop()) break;
      processSearchSnippet(item, query, location, leads, seenProfiles, onProgress, maxResults);
    }
  } catch (err) {
    onProgress({ stage: 'bing_xray_err', message: `Bing search notice: ${err.message}` });
  }
}

async function scrapeDuckDuckGo(page, { query, location, emailTerm, maxResults, leads, seenProfiles, onProgress, shouldStop }) {
  try {
    const q = `site:linkedin.com/in "${query}" "${location}" ${emailTerm}`.trim();
    const url = `https://duckduckgo.com/?q=${encodeURIComponent(q)}&ia=web`;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2500);

    const results = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll('article, [data-testid="result"], li');

      cards.forEach(card => {
        const a = card.querySelector('a[href*="linkedin.com/in/"]');
        if (!a) return;

        const h2 = card.querySelector('h2');
        const title = h2 ? h2.textContent.trim() : '';
        const snippet = card.innerText;

        if (title && a.href) {
          items.push({ href: a.href, title, snippet });
        }
      });

      return items;
    });

    for (const item of results) {
      if (leads.length >= maxResults || shouldStop()) break;
      processSearchSnippet(item, query, location, leads, seenProfiles, onProgress, maxResults);
    }
  } catch (err) {
    onProgress({ stage: 'ddg_xray_err', message: `DuckDuckGo notice: ${err.message}` });
  }
}

function processSearchSnippet(item, query, location, leads, seenProfiles, onProgress, maxResults) {
  let cleanUrl = item.href;
  try {
    const parsed = new URL(item.href);
    cleanUrl = parsed.origin + parsed.pathname;
  } catch (e) {}

  if (seenProfiles.has(cleanUrl)) return;
  seenProfiles.add(cleanUrl);

  // Parse Name and Headline
  let name = item.title
    .replace(/\s*\|\s*LinkedIn.*$/i, '')
    .replace(/\s*-\s*LinkedIn.*$/i, '')
    .replace(/^[‏\s]+|[‏\s]+$/g, '')
    .trim();

  let headline = query;
  const titleParts = name.split(/\s*[-–—|]\s*/);
  if (titleParts.length > 1) {
    name = titleParts[0].trim();
    headline = titleParts.slice(1).join(' - ').trim();
  }

  const combinedText = `${item.title} ${item.snippet}`;
  const foundEmails = extractEmailsFromText(combinedText);

  // Phone match regex
  const phoneMatch = item.snippet.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
  const phone = phoneMatch ? phoneMatch[0] : '';

  const lead = {
    name: cleanText(name) || 'Professional',
    primaryEmail: foundEmails[0] || '',
    emails: foundEmails,
    phone,
    website: cleanUrl,
    linkedin: cleanUrl,
    category: cleanText(headline) || query,
    address: location,
    location: location,
    rating: '',
    reviewsCount: '',
    mapsUrl: '',
    dateScraped: new Date().toISOString().split('T')[0],
    source: 'LinkedIn'
  };

  leads.push(lead);

  onProgress({
    stage: 'lead_found',
    lead,
    currentCount: leads.length,
    total: maxResults,
    message: `✓ [LinkedIn] ${lead.name} (${lead.primaryEmail || 'Profile Discovered'})`
  });
}

module.exports = {
  scrapeLinkedInLeads
};
