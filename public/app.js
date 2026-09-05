// DOM Elements
const scrapeForm = document.getElementById('scrapeForm');
const queryInput = document.getElementById('queryInput');
const queryLabel = document.getElementById('queryLabel');
const locationInput = document.getElementById('locationInput');
const maxResultsSelect = document.getElementById('maxResults');
const emailProviderSelect = document.getElementById('emailProvider');
const autoDownloadCheck = document.getElementById('autoDownloadCheck');
const autoDownloadFormat = document.getElementById('autoDownloadFormat');

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusBadge = document.getElementById('statusBadge');

const statFound = document.getElementById('statFound');
const statEmails = document.getElementById('statEmails');
const statPhones = document.getElementById('statPhones');
const statWebsites = document.getElementById('statWebsites');

const progressSection = document.getElementById('progressSection');
const progressMessage = document.getElementById('progressMessage');
const progressPercent = document.getElementById('progressPercent');
const progressBar = document.getElementById('progressBar');

const downloadExcelBtn = document.getElementById('downloadExcelBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const copyEmailsBtn = document.getElementById('copyEmailsBtn');

const leadsCount = document.getElementById('leadsCount');
const tableSearch = document.getElementById('tableSearch');
const leadsTableBody = document.getElementById('leadsTableBody');
const logTerminal = document.getElementById('logTerminal');

const pastFilesList = document.getElementById('pastFilesList');
const refreshFilesBtn = document.getElementById('refreshFilesBtn');
const toastEl = document.getElementById('toast');

// LinkedIn Account DOM Elements
const linkedinAccountCard = document.getElementById('linkedinAccountCard');
const linkedinAccountFields = document.getElementById('linkedinAccountFields');
const linkedinModeRadios = document.querySelectorAll('input[name="linkedinMode"]');
const liEmailInput = document.getElementById('liEmail');
const liPasswordInput = document.getElementById('liPassword');
const liCookieInput = document.getElementById('liCookie');

// Application State
let selectedPlatform = 'both';
let isScraping = false;
let pollingInterval = null;
let currentLeads = [];
let downloadedForCurrentJob = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupPlatformSelector();
  setupLinkedInMode();
  setupQuickTags();
  checkInitialStatus();
  fetchPastFiles();
});

// Toast notification helper
function showToast(message, type = 'info') {
  toastEl.textContent = message;
  toastEl.className = `toast show ${type}`;
  setTimeout(() => {
    toastEl.className = 'toast';
  }, 4500);
}

// Platform selection logic
function setupPlatformSelector() {
  const options = document.querySelectorAll('.platform-option');
  options.forEach(opt => {
    opt.addEventListener('click', () => {
      options.forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      const radio = opt.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;

      selectedPlatform = opt.getAttribute('data-platform') || 'both';

      if (selectedPlatform === 'linkedin') {
        queryLabel.textContent = 'Target Job Title / Role / Industry';
        queryInput.placeholder = 'e.g. CEO, Founder, Real Estate Broker, Dentist, Marketing Director';
        if (linkedinAccountCard) linkedinAccountCard.style.display = 'block';
      } else if (selectedPlatform === 'google_maps') {
        queryLabel.textContent = 'Business Niche / Category';
        queryInput.placeholder = 'e.g. Dentists, Real Estate Agencies, Plumbers, Restaurants';
        if (linkedinAccountCard) linkedinAccountCard.style.display = 'none';
      } else {
        queryLabel.textContent = 'Business Niche / Target Role';
        queryInput.placeholder = 'e.g. Real Estate, Dentists, CEOs, Digital Marketing, Plumbers';
        if (linkedinAccountCard) linkedinAccountCard.style.display = 'block';
      }
    });
  });
}

function setupLinkedInMode() {
  linkedinModeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'account') {
        linkedinAccountFields.classList.remove('hidden');
      } else {
        linkedinAccountFields.classList.add('hidden');
      }
    });
  });
}

// Quick tag click handlers
function setupQuickTags() {
  document.querySelectorAll('.tag-btn[data-val]').forEach(btn => {
    btn.addEventListener('click', () => {
      queryInput.value = btn.getAttribute('data-val');
      queryInput.focus();
    });
  });

  document.querySelectorAll('.tag-btn[data-loc]').forEach(btn => {
    btn.addEventListener('click', () => {
      locationInput.value = btn.getAttribute('data-loc');
      locationInput.focus();
    });
  });
}

// Check initial status on page load
async function checkInitialStatus() {
  try {
    const res = await fetch('/api/scrape/status');
    const data = await res.json();
    if (data.isRunning) {
      setScrapingActive(true);
      startPolling();
    } else if (data.leads && data.leads.length > 0) {
      currentLeads = data.leads;
      updateMetrics(data.stats);
      renderTable(currentLeads);
      updateExportButtons(true);
    }
  } catch (err) {
    console.error('Failed to get initial status:', err);
  }
}

// Form submission -> Start scrape
scrapeForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const query = queryInput.value.trim();
  const location = locationInput.value.trim();
  const maxResults = parseInt(maxResultsSelect.value, 10);
  const emailProvider = emailProviderSelect.value;
  const platform = selectedPlatform;

  if (!query || !location) {
    showToast('Please enter both a niche/role and location.', 'error');
    return;
  }

  try {
    startBtn.disabled = true;
    startBtn.innerHTML = 'Starting...';

    const linkedinMode = document.querySelector('input[name="linkedinMode"]:checked')?.value || 'stealth';
    const linkedinAccount = {
      mode: linkedinMode,
      email: liEmailInput ? liEmailInput.value.trim() : '',
      password: liPasswordInput ? liPasswordInput.value.trim() : '',
      liAt: liCookieInput ? liCookieInput.value.trim() : ''
    };

    const res = await fetch('/api/scrape/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        location,
        platform,
        emailProvider,
        maxResults,
        linkedinAccount
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to start scraper.');
    }

    showToast(data.message, 'success');
    downloadedForCurrentJob = false;
    currentLeads = [];
    renderTable([]);
    setScrapingActive(true);
    startPolling();

  } catch (err) {
    showToast(err.message, 'error');
    setScrapingActive(false);
  }
});

// Stop button
stopBtn.addEventListener('click', async () => {
  try {
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping...';
    const res = await fetch('/api/scrape/stop', { method: 'POST' });
    const data = await res.json();
    showToast(data.message, 'info');
  } catch (err) {
    showToast('Error stopping scraper: ' + err.message, 'error');
  }
});

function setScrapingActive(active) {
  isScraping = active;
  startBtn.disabled = active;
  startBtn.innerHTML = active ? 'Scraping Active...' : `
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>
    Start Lead Scraping
  `;
  stopBtn.disabled = !active;
  stopBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
      <rect x="6" y="6" width="12" height="12"></rect>
    </svg>
    Stop
  `;

  if (active) {
    statusBadge.className = 'badge badge-running';
    statusBadge.textContent = '● Scraping Live';
    progressSection.classList.remove('hidden');
  } else {
    statusBadge.className = 'badge badge-idle';
    statusBadge.textContent = '● Ready';
  }
}

function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/scrape/status');
      const data = await res.json();

      updateMetrics(data.stats);
      updateLogs(data.logs);

      if (data.leads && data.leads.length !== currentLeads.length) {
        currentLeads = data.leads;
        renderTable(currentLeads);
        updateExportButtons(currentLeads.length > 0);
      }

      // Calculate progress
      const target = data.job?.maxResults || 20;
      const progress = Math.min(Math.round((data.stats.processed / target) * 100), 100);
      progressBar.style.width = `${progress}%`;
      progressPercent.textContent = `${progress}%`;

      if (data.logs && data.logs.length > 0) {
        progressMessage.textContent = data.logs[data.logs.length - 1].message;
      }

      // Scraping has finished
      if (!data.isRunning) {
        clearInterval(pollingInterval);
        setScrapingActive(false);

        if (currentLeads.length > 0) {
          progressBar.style.width = '100%';
          progressPercent.textContent = '100%';
          progressMessage.textContent = `Completed! Successfully scraped ${currentLeads.length} leads.`;

          // Trigger Auto-Download if enabled
          if (autoDownloadCheck.checked && !downloadedForCurrentJob) {
            downloadedForCurrentJob = true;
            const format = autoDownloadFormat.value;
            triggerAutoDownload(format);
          }
        } else {
          progressSection.classList.add('hidden');
        }

        fetchPastFiles();
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 1400);
}

// Automatic download trigger
function triggerAutoDownload(format) {
  showToast(`🎉 Leads ready! Auto-downloading ${format.toUpperCase()} file to your computer...`, 'success');
  const downloadUrl = `/api/download/${format}`;

  const link = document.createElement('a');
  link.href = downloadUrl;
  link.setAttribute('download', '');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Update metric cards
function updateMetrics(stats = {}) {
  statFound.textContent = stats.totalFound || 0;
  statEmails.textContent = stats.emailsFound || 0;
  statPhones.textContent = stats.phonesFound || 0;
  statWebsites.textContent = stats.websitesFound || 0;
}

// Render leads table
function renderTable(leads) {
  leadsCount.textContent = leads.length;

  const searchTerm = tableSearch.value.toLowerCase().trim();
  const filtered = leads.filter(l => {
    if (!searchTerm) return true;
    return (
      (l.name && l.name.toLowerCase().includes(searchTerm)) ||
      (l.primaryEmail && l.primaryEmail.toLowerCase().includes(searchTerm)) ||
      (l.phone && l.phone.toLowerCase().includes(searchTerm)) ||
      (l.website && l.website.toLowerCase().includes(searchTerm)) ||
      (l.category && l.category.toLowerCase().includes(searchTerm)) ||
      (l.source && l.source.toLowerCase().includes(searchTerm))
    );
  });

  if (filtered.length === 0) {
    leadsTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="8">
          ${leads.length === 0 ? 'No leads scraped yet. Click <strong>Start Lead Scraping</strong>.' : 'No leads match your search query.'}
        </td>
      </tr>
    `;
    return;
  }

  leadsTableBody.innerHTML = filtered.map((lead, idx) => {
    const isLinkedIn = lead.source === 'LinkedIn';
    const sourceBadge = isLinkedIn
      ? `<span class="badge-source badge-source-linkedin">💼 LinkedIn</span>`
      : `<span class="badge-source badge-source-google">📍 Google</span>`;

    const emailHtml = lead.primaryEmail
      ? `<a href="mailto:${lead.primaryEmail}" class="email-pill" title="Click to compose email">${lead.primaryEmail}</a>`
      : '<span class="no-email">No public email</span>';

    const webHtml = lead.website
      ? `<a href="${lead.website}" target="_blank" rel="noopener" class="download-link" title="${lead.website}">${isLinkedIn ? 'Profile ↗' : 'Visit Site ↗'}</a>`
      : '<span class="no-email">-</span>';

    const mapsHtml = lead.mapsUrl
      ? `<a href="${lead.mapsUrl}" target="_blank" rel="noopener" class="download-link" title="Google Maps">Maps ↗</a>`
      : '';

    const socials = [];
    if (lead.linkedin) socials.push(`<a href="${lead.linkedin}" target="_blank" class="social-icon social-in" title="LinkedIn">in</a>`);
    if (lead.facebook) socials.push(`<a href="${lead.facebook}" target="_blank" class="social-icon social-fb" title="Facebook">fb</a>`);
    if (lead.instagram) socials.push(`<a href="${lead.instagram}" target="_blank" class="social-icon social-ig" title="Instagram">ig</a>`);
    if (lead.twitter) socials.push(`<a href="${lead.twitter}" target="_blank" class="social-icon social-tw" title="Twitter/X">x</a>`);

    return `
      <tr>
        <td style="color: #64748b;">${idx + 1}</td>
        <td>${sourceBadge}</td>
        <td>
          <div class="lead-name">${escapeHtml(lead.name)}</div>
          <div class="lead-category">${escapeHtml(lead.category || '')}</div>
        </td>
        <td>${emailHtml}</td>
        <td>${escapeHtml(lead.phone || '-')}</td>
        <td>${webHtml}</td>
        <td>
          <div style="font-size: 0.82rem;">${escapeHtml(lead.address || '-')}</div>
          ${lead.rating ? `<div style="font-size: 0.75rem; color: #fbbf24;">★ ${lead.rating} (${lead.reviewsCount || 0}) ${mapsHtml ? '· ' + mapsHtml : ''}</div>` : ''}
        </td>
        <td>
          <div class="social-links">
            ${socials.length > 0 ? socials.join('') : '<span class="no-email">-</span>'}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function updateExportButtons(enabled) {
  downloadExcelBtn.disabled = !enabled;
  downloadCsvBtn.disabled = !enabled;
  copyEmailsBtn.disabled = !enabled;
}

// Manual export buttons
downloadExcelBtn.addEventListener('click', () => {
  window.location.href = '/api/download/excel';
});

downloadCsvBtn.addEventListener('click', () => {
  window.location.href = '/api/download/csv';
});

copyEmailsBtn.addEventListener('click', () => {
  const emails = [];
  currentLeads.forEach(lead => {
    if (lead.emails && lead.emails.length > 0) {
      lead.emails.forEach(e => {
        if (!emails.includes(e)) emails.push(e);
      });
    } else if (lead.primaryEmail && !emails.includes(lead.primaryEmail)) {
      emails.push(lead.primaryEmail);
    }
  });

  if (emails.length === 0) {
    showToast('No emails to copy yet.', 'error');
    return;
  }

  navigator.clipboard.writeText(emails.join(', ')).then(() => {
    showToast(`Copied ${emails.length} email(s) to clipboard!`, 'success');
  }).catch(() => {
    showToast('Failed to copy to clipboard.', 'error');
  });
});

// Search filter in table
tableSearch.addEventListener('input', () => {
  renderTable(currentLeads);
});

// Update activity logs
function updateLogs(logs = []) {
  if (logs.length === 0) return;
  logTerminal.innerHTML = logs.map(l => `
    <div class="log-line ${l.type || 'info'}">
      [${l.timestamp}] ${escapeHtml(l.message)}
    </div>
  `).join('');
  logTerminal.scrollTop = logTerminal.scrollHeight;
}

// Fetch past export files in exports/ directory
async function fetchPastFiles() {
  try {
    const res = await fetch('/api/exports');
    const files = await res.json();

    if (!files || files.length === 0) {
      pastFilesList.innerHTML = '<p class="empty-note">No exported files yet. Completed scrapes will appear here.</p>';
      return;
    }

    pastFilesList.innerHTML = files.map(f => `
      <div class="past-file-item">
        <div class="file-info">
          <span class="file-name">${escapeHtml(f.name)}</span>
          <span class="file-meta">${f.size} · ${f.date}</span>
        </div>
        <a href="/api/exports/${encodeURIComponent(f.name)}" class="download-link" download>Download</a>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to fetch past files:', err);
  }
}

refreshFilesBtn.addEventListener('click', fetchPastFiles);

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
