const cheerio = require('cheerio');
const { extractEmailsFromText, extractEmailsFromHtml, decodeCloudflareEmail } = require('./src/emailExtractor');

console.log('--- 1. Testing Obfuscated & Modern TLD Emails ---');
const sampleText = `
  Direct corporate: ceo@techagency.ai, sales@lawfirm.co.uk, info@startup.agency
  Webmail: realtor.miami@gmail.com, doctor@outlook.com
  Obfuscated: support [at] realestate.org, contact (at) dentalgroup.com
`;
const textEmails = extractEmailsFromText(sampleText);
console.log('Extracted Text Emails:', textEmails);

console.log('\n--- 2. Testing Cloudflare Protection & Schema.org Metadata ---');
const htmlSample = `
  <html>
    <head>
      <script type="application/ld+json">
        {"@context": "https://schema.org", "@type": "LocalBusiness", "email": "director@businesscorp.com"}
      </script>
      <meta name="email" content="press@company.net">
    </head>
    <body>
      <p>Protected: <span class="__cf_email__" data-cfemail="1f7c70716b7e7c6b5f7e737a677e737e6a767178317c7072">[email&#160;protected]</span></p>
      <a href="mailto:hello@innovate.co">Mail Us</a>
    </body>
  </html>
`;
const $ = cheerio.load(htmlSample);
const htmlEmails = extractEmailsFromHtml(htmlSample, $);
console.log('Extracted HTML & Meta Emails:', htmlEmails);

if (
  textEmails.includes('ceo@techagency.ai') &&
  textEmails.includes('realtor.miami@gmail.com') &&
  textEmails.includes('support@realestate.org') &&
  htmlEmails.includes('director@businesscorp.com') &&
  htmlEmails.includes('press@company.net') &&
  htmlEmails.includes('hello@innovate.co')
) {
  console.log('\nSUCCESS: All email types (corporate, webmail, obfuscated, schema, meta) verified!');
} else {
  console.error('\nFAILURE: Some email types were missed!');
  process.exit(1);
}
