const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { findChromePath, sleep, randomSleep, cleanText, normalizeUrl } = require('./utils');

puppeteer.use(StealthPlugin());

/**
 * Scrapes Google Maps listings for a given niche and location.
 * @param {Object} options
 * @param {string} options.query - Business niche/keyword (e.g., "Plumbers", "Real Estate")
 * @param {string} options.location - City/area (e.g., "Miami, FL", "London")
 * @param {number} options.maxResults - Max number of businesses to extract (default: 20)
 * @param {Function} [options.onProgress] - Callback for real-time progress updates
 * @param {Function} [options.shouldStop] - Callback to check if user aborted
 */
async function scrapeGoogleMaps({ query, location, maxResults = 20, onProgress = () => {}, shouldStop = () => false }) {
  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error('Google Chrome or Microsoft Edge was not found on your system. Please install Google Chrome.');
  }

  const searchQuery = `${query} in ${location}`;
  onProgress({ stage: 'browser_launching', message: 'Launching stealth browser engine...' });

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new", // Run in background headless mode
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

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    );

    // Block image / font loading in maps to save bandwidth and speed up scraping
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'media', 'font'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const targetUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}?hl=en`;
    onProgress({ stage: 'navigating', message: `Navigating to Google Maps for "${searchQuery}"...` });

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Handle Google Consent / Cookie dialogs if present
    try {
      const consentButtons = await page.$$('button');
      for (const btn of consentButtons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && (text.includes('Accept all') || text.includes('I agree') || text.includes('Agree'))) {
          await btn.click();
          await sleep(1500);
          break;
        }
      }
    } catch (e) {
      // Ignore consent errors
    }

    // Identify results feed
    onProgress({ stage: 'searching', message: 'Searching listings on Google Maps...' });

    // Try finding the feed container
    const feedSelector = 'div[role="feed"]';
    let feedFound = false;
    try {
      await page.waitForSelector(feedSelector, { timeout: 10000 });
      feedFound = true;
    } catch (e) {
      // Feed not found; check if a single business detail page was opened directly
    }

    if (!feedFound) {
      // Check if it's a direct business match
      const directNameEl = await page.$('h1.DUwDvf');
      if (directNameEl) {
        const directLead = await extractCurrentDetailPage(page, query, location);
        if (directLead) leads.push(directLead);
        await browser.close();
        return leads;
      }
    }

    // Scroll through results to collect business card elements
    let itemCount = 0;
    let previousCount = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 35;
    while (itemCount < maxResults && scrollAttempts < maxScrollAttempts) {
      if (shouldStop()) break;

      // Extract current visible items
      const items = await page.$$('div.Nv2PK, a.hfpxzc');
      itemCount = items.length;
      if (itemCount === 0) {
        break;
      }

      onProgress({
        stage: 'scrolling',
        message: `Found ${itemCount} listings on Google Maps...`,
        currentCount: itemCount,
        targetCount: maxResults
      });

      if (itemCount >= maxResults) {
        break; // Reached target leads count
      }

      if (itemCount === previousCount) {
        scrollAttempts++;
      } else {
        scrollAttempts = 0;
        previousCount = itemCount;
      }

      // Scroll the feed element
      await page.evaluate((selector) => {
        const feed = document.querySelector(selector);
        if (feed) {
          feed.scrollBy(0, 1000);
        } else {
          window.scrollBy(0, 1000);
        }
      }, feedSelector);

      await sleep(1200);

      // Check if reached end of results
      const endOfList = await page.evaluate(() => {
        const endText = document.body.innerText;
        return endText.includes("You've reached the end of the list") || endText.includes("No more results");
      });
      if (endOfList) break;
    }

    // Now extract card details from the loaded listings
    onProgress({ stage: 'extracting', message: 'Extracting business details from Google Maps cards...' });

    const businessCards = await page.evaluate((limit) => {
      const cards = document.querySelectorAll('div.Nv2PK');
      const results = [];

      for (let i = 0; i < cards.length && results.length < limit; i++) {
        const card = cards[i];

        // Name
        const nameEl = card.querySelector('div.qBF1Pd, .fontHeadlineSmall');
        const name = nameEl ? nameEl.textContent.trim() : '';

        // Google Maps Link
        const linkEl = card.querySelector('a.hfpxzc');
        const mapsUrl = linkEl ? linkEl.getAttribute('href') : '';

        // Rating and reviews
        const ratingEl = card.querySelector('span.MW4etd');
        const rating = ratingEl ? ratingEl.textContent.trim() : '';

        const reviewsEl = card.querySelector('span.UY7F9');
        const reviewsCount = reviewsEl ? reviewsEl.textContent.replace(/[()]/g, '').trim() : '';

        // Category, address, phone from snippet texts
        const snippetLines = card.querySelectorAll('div.W4Efsd');
        let category = '';
        let address = '';
        let phone = '';

        snippetLines.forEach(line => {
          const text = line.textContent.trim();
          // Phone regex test
          const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
          if (phoneMatch && !phone) {
            phone = phoneMatch[0];
          }
          if (!category && text.length > 2 && text.length < 40 && !phoneMatch) {
            category = text.split('·')[0].trim();
          }
        });

        // Website link on card
        let website = '';
        const webEl = card.querySelector('a[data-value="Website"], a.lcr4fd, a[aria-label*="website" i]');
        if (webEl) {
          website = webEl.getAttribute('href') || '';
        }

        if (name) {
          results.push({
            name,
            mapsUrl,
            rating,
            reviewsCount,
            category,
            address,
            phone,
            website
          });
        }
      }

      return results;
    }, maxResults);

    // If some cards didn't have website/phone directly in card snippet, inspect card or details
    for (let i = 0; i < businessCards.length; i++) {
      if (shouldStop()) break;

      const card = businessCards[i];
      let cleanWeb = normalizeUrl(card.website);

      // If website not found directly on card snippet, click into listing to read official website
      if (!cleanWeb && card.mapsUrl) {
        try {
          const detailPage = await browser.newPage();
          await detailPage.goto(card.mapsUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await sleep(1000);

          const detailData = await detailPage.evaluate(() => {
            let site = '';
            let tel = '';
            let addr = '';

            const siteEl = document.querySelector('a[data-item-id="authority"], a[aria-label*="website" i], a[data-tooltip*="Open website" i]');
            if (siteEl) site = siteEl.getAttribute('href');

            const phoneEl = document.querySelector('button[data-item-id*="phone:"], button[aria-label*="Phone" i]');
            if (phoneEl) tel = phoneEl.getAttribute('aria-label') || phoneEl.textContent;

            const addrEl = document.querySelector('button[data-item-id="address"], button[aria-label*="Address" i]');
            if (addrEl) addr = addrEl.getAttribute('aria-label') || addrEl.textContent;

            return { site, tel, addr };
          });

          if (detailData.site) cleanWeb = normalizeUrl(detailData.site);
          if (detailData.tel && !card.phone) {
            card.phone = cleanText(detailData.tel.replace(/Phone:\s*/i, ''));
          }
          if (detailData.addr && !card.address) {
            card.address = cleanText(detailData.addr.replace(/Address:\s*/i, ''));
          }

          await detailPage.close();
        } catch (e) {
          // Ignore individual detail page failures
        }
      }

      card.website = cleanWeb || '';
      card.location = location;
      card.query = query;
      card.dateScraped = new Date().toISOString().split('T')[0];

      leads.push(card);

      onProgress({
        stage: 'business_collected',
        lead: card,
        index: i + 1,
        total: businessCards.length,
        message: `Extracted: ${card.name} (${card.website || 'No website'})`
      });
    }

  } catch (error) {
    onProgress({ stage: 'error', message: `Maps search error: ${error.message}` });
  } finally {
    await browser.close().catch(() => {});
  }

  return leads;
}

async function extractCurrentDetailPage(page, query, location) {
  return await page.evaluate((q, loc) => {
    const nameEl = document.querySelector('h1.DUwDvf');
    const name = nameEl ? nameEl.textContent.trim() : '';
    if (!name) return null;

    const siteEl = document.querySelector('a[data-item-id="authority"], a[aria-label*="website" i]');
    const website = siteEl ? siteEl.getAttribute('href') : '';

    const phoneEl = document.querySelector('button[data-item-id*="phone:"], button[aria-label*="Phone" i]');
    const phone = phoneEl ? (phoneEl.getAttribute('aria-label') || phoneEl.textContent).replace(/Phone:\s*/i, '').trim() : '';

    const addrEl = document.querySelector('button[data-item-id="address"], button[aria-label*="Address" i]');
    const address = addrEl ? (addrEl.getAttribute('aria-label') || addrEl.textContent).replace(/Address:\s*/i, '').trim() : '';

    return {
      name,
      website,
      phone,
      address,
      query: q,
      location: loc,
      dateScraped: new Date().toISOString().split('T')[0]
    };
  }, query, location);
}

module.exports = {
  scrapeGoogleMaps
};
