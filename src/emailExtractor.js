const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const { getRandomUserAgent } = require('./utils');

// Custom HTTPS agent to avoid failing on self-signed or legacy SSL certificates
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

// Comprehensive regex matching ALL valid standard and custom domain emails
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}/gi;

// Patterns to discard obvious image/asset false positives
const JUNK_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf', '.css', '.js', '.woff', '.woff2', '.mp4', '.mp3'];
const JUNK_DOMAINS = [
  'sentry.io', 'wixpress.com', 'example.com', 'domain.com',
  'schema.org', 'googleapis.com', 'cloudflare.com', 'wordpress.org',
  'gravatar.com', 'themeforest.net', 'envato.com', 'bootstrap.com',
  'jquery.com', 'w3.org'
];

/**
 * Decodes Cloudflare email protection data-cfemail strings.
 */
function decodeCloudflareEmail(encodedString) {
  try {
    let email = "";
    const r = parseInt(encodedString.substr(0, 2), 16);
    for (let n = 2; encodedString.length - n; n += 2) {
      email += String.fromCharCode(parseInt(encodedString.substr(n, 2), 16) ^ r);
    }
    return email.toLowerCase();
  } catch (e) {
    return null;
  }
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const lower = email.toLowerCase().trim();

  // Basic length sanity check
  if (lower.length < 5 || lower.length > 90) return false;

  // Must have a valid dot in domain
  const parts = lower.split('@');
  if (parts.length !== 2 || !parts[1].includes('.')) return false;

  // Discard file extension matches
  for (const ext of JUNK_EXTENSIONS) {
    if (lower.endsWith(ext) || lower.includes(ext + '@')) return false;
  }

  // Discard system/tracker domains
  for (const domain of JUNK_DOMAINS) {
    if (lower.includes('@' + domain) || lower.endsWith('.' + domain)) return false;
  }

  // Discard placeholders
  if (
    lower.startsWith('yourname@') ||
    lower.startsWith('username@') ||
    lower.startsWith('email@') ||
    lower.startsWith('name@') ||
    lower.startsWith('user@') ||
    lower.startsWith('test@') ||
    lower.includes('sample@')
  ) {
    return false;
  }

  return true;
}

function extractSocialLinks($, baseUrl) {
  const socials = {
    facebook: '',
    instagram: '',
    linkedin: '',
    twitter: ''
  };

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const lower = href.toLowerCase();

    if (!socials.facebook && lower.includes('facebook.com/') && !lower.includes('/sharer')) {
      socials.facebook = href;
    } else if (!socials.instagram && lower.includes('instagram.com/')) {
      socials.instagram = href;
    } else if (!socials.linkedin && lower.includes('linkedin.com/')) {
      socials.linkedin = href;
    } else if (!socials.twitter && (lower.includes('twitter.com/') || lower.includes('x.com/')) && !lower.includes('/intent/')) {
      socials.twitter = href;
    }
  });

  return socials;
}

function extractEmailsFromText(text) {
  if (!text) return [];

  // Decode common HTML entities like &#64; or &commat;
  const decodedText = text
    .replace(/&#64;|&commat;/gi, '@')
    .replace(/&#46;/gi, '.');

  const found = decodedText.match(EMAIL_REGEX) || [];
  const results = new Set(found.map(e => e.toLowerCase().trim()).filter(isValidEmail));

  // Extract obfuscated email patterns: "user [at] domain [dot] com", "user (at) domain . com"
  const obfuscatedRegex = /([a-zA-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\s+at\s+|@)\s*([a-zA-Z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\s+dot\s+|\.)\s*([a-zA-Z]{2,10})/gi;
  let match;
  while ((match = obfuscatedRegex.exec(decodedText)) !== null) {
    const candidate = `${match[1]}@${match[2]}.${match[3]}`.toLowerCase();
    if (isValidEmail(candidate)) {
      results.add(candidate);
    }
  }

  return Array.from(results);
}

function extractEmailsFromHtml(html, $) {
  const emails = new Set();

  // 1. Check mailto: links
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const cleanMailto = href.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
    if (isValidEmail(cleanMailto)) {
      emails.add(cleanMailto);
    }
  });

  // 2. Check Cloudflare Protected Emails
  $('[data-cfemail]').each((_, el) => {
    const cfVal = $(el).attr('data-cfemail');
    if (cfVal) {
      const decoded = decodeCloudflareEmail(cfVal);
      if (isValidEmail(decoded)) {
        emails.add(decoded);
      }
    }
  });

  // 3. Check JSON-LD metadata (<script type="application/ld+json">)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const content = $(el).html();
      const metaEmails = extractEmailsFromText(content);
      metaEmails.forEach(e => emails.add(e));
    } catch (e) {}
  });

  // 4. Check meta tags (<meta name="email" content="...">)
  $('meta[name*="email" i], meta[property*="email" i]').each((_, el) => {
    const content = $(el).attr('content');
    if (content && isValidEmail(content)) {
      emails.add(content.toLowerCase().trim());
    }
  });

  // 5. Scan entire page body text
  const bodyText = $('body').text();
  const textEmails = extractEmailsFromText(bodyText);
  textEmails.forEach(e => emails.add(e));

  return Array.from(emails);
}

async function fetchPage(url) {
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      maxRedirects: 5,
      httpsAgent,
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (typeof response.data === 'string') {
      return response.data;
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function extractFromWebsite(websiteUrl) {
  const result = {
    emails: [],
    primaryEmail: '',
    facebook: '',
    instagram: '',
    linkedin: '',
    twitter: ''
  };

  if (!websiteUrl) return result;

  try {
    let baseUrl = websiteUrl;
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      baseUrl = 'https://' + baseUrl;
    }

    const homeHtml = await fetchPage(baseUrl);
    if (!homeHtml) {
      // Retry once with http if https failed
      if (baseUrl.startsWith('https://')) {
        const fallbackHtml = await fetchPage(baseUrl.replace('https://', 'http://'));
        if (fallbackHtml) {
          return parsePageAndSubpages(fallbackHtml, baseUrl.replace('https://', 'http://'));
        }
      }
      return result;
    }

    return await parsePageAndSubpages(homeHtml, baseUrl);
  } catch (err) {
    return result;
  }
}

async function parsePageAndSubpages(homeHtml, baseUrl) {
  const result = {
    emails: [],
    primaryEmail: '',
    facebook: '',
    instagram: '',
    linkedin: '',
    twitter: ''
  };

  const $ = cheerio.load(homeHtml);
  const foundEmails = new Set(extractEmailsFromHtml(homeHtml, $));

  const socials = extractSocialLinks($, baseUrl);
  result.facebook = socials.facebook;
  result.instagram = socials.instagram;
  result.linkedin = socials.linkedin;
  result.twitter = socials.twitter;

  // Find contact / about pages to crawl
  const contactLinks = [];
  const contactPatterns = [/contact/i, /about/i, /reach/i, /get-in-touch/i, /team/i, /impressum/i, /support/i];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text();
    if (!href) return;

    for (const pattern of contactPatterns) {
      if (pattern.test(href) || pattern.test(text)) {
        try {
          const resolved = new URL(href, baseUrl).toString();
          if (new URL(resolved).origin === new URL(baseUrl).origin && !contactLinks.includes(resolved)) {
            contactLinks.push(resolved);
          }
        } catch (e) {}
        break;
      }
    }
  });

  // Crawl up to 4 contact/about subpages concurrently
  const targets = contactLinks.slice(0, 4);
  if (targets.length > 0) {
    const pagesContent = await Promise.all(targets.map(url => fetchPage(url)));
    for (const pageHtml of pagesContent) {
      if (pageHtml) {
        const sub$ = cheerio.load(pageHtml);
        const subEmails = extractEmailsFromHtml(pageHtml, sub$);
        subEmails.forEach(e => foundEmails.add(e));

        const subSocials = extractSocialLinks(sub$, baseUrl);
        if (!result.facebook && subSocials.facebook) result.facebook = subSocials.facebook;
        if (!result.instagram && subSocials.instagram) result.instagram = subSocials.instagram;
        if (!result.linkedin && subSocials.linkedin) result.linkedin = subSocials.linkedin;
        if (!result.twitter && subSocials.twitter) result.twitter = subSocials.twitter;
      }
    }
  }

  const allEmails = Array.from(foundEmails);
  result.emails = allEmails;

  // Determine best primary email:
  // Prefer direct or official emails (contact@, info@, hello@, sales@, office@, or corporate domain emails)
  if (allEmails.length > 0) {
    const preferredOrder = ['contact@', 'info@', 'hello@', 'support@', 'office@', 'admin@', 'sales@'];
    let best = allEmails[0];
    for (const prefix of preferredOrder) {
      const match = allEmails.find(e => e.startsWith(prefix));
      if (match) {
        best = match;
        break;
      }
    }
    result.primaryEmail = best;
  }

  return result;
}

module.exports = {
  extractFromWebsite,
  isValidEmail,
  extractEmailsFromText,
  extractEmailsFromHtml,
  decodeCloudflareEmail
};
