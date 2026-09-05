# 🚀 Google Business Email Scraper & Lead Generator

A full-stack, automated lead generation tool tailored for **email marketing and B2B outreach**. It queries Google Maps and business websites for any niche and geographic area, extracts verified business emails, phone numbers, and social links, and **automatically downloads clean CSV and Excel files**.

---

## ⚡ Features

- **Google Maps & Local Area Targeting**: Search by business niche (`Dentists`, `Real Estate`, `Plumbers`, `Agencies`, `Restaurants`) and geographic location (`Miami, FL`, `New York`, `London, UK`, etc.).
- **Deep Website Email Crawler**: Crawls company homepages, `/contact`, `/about-us`, `/team`, and `/impressum` pages to find contact emails.
- **Anti-Spam Filtering**: Removes junk placeholder emails (e.g. `.png`, `.jpg`, tracker IDs, Sentry, Wix system emails).
- **Social Media Detection**: Extracts LinkedIn, Instagram, Facebook, and Twitter/X profiles.
- **⚡ Automatic File Download**: As soon as scraping completes, your browser automatically downloads the results in Excel (`.xlsx`) or CSV.
- **Local Auto-Save**: All leads are permanently saved in the local `exports/` folder with timestamped filenames.
- **Interactive Web Dashboard**: Live streaming table, progress bars, real-time counters, search filter, and 1-click clipboard copy for marketing campaigns.
- **1-Click Windows Launch**: Double-click `start.bat` to launch instantly.

---

## 🚀 Quick Start (Windows)

### Option 1: One-Click Launch (Easiest)
Simply double-click the **`start.bat`** file in this folder. It will:
1. Verify dependencies.
2. Launch the backend server.
3. Automatically open `http://localhost:3000` in your default browser.

### Option 2: Command Line
Open a terminal in this folder and run:
```bash
npm start
```
Then visit:
```
http://localhost:3000
```

---

## 📋 How to Use

1. Enter your **Business Niche / Category** (e.g., `Dentists`, `Real Estate`, `Plumbers`).
2. Enter your **Target Location / Area** (e.g., `Austin, TX`, `Miami, FL`, `London, UK`).
3. Select your desired **Lead Count** (10, 20, 50, 100).
4. Ensure **"Auto-download file immediately when completed"** is checked.
5. Click **Start Lead Scraping**.
6. Watch leads stream in real-time. When scraping completes, your browser will automatically trigger the download!

---

## 📊 Exported Fields

Every exported CSV and Excel (`.xlsx`) file includes:
- **Business Name**
- **Primary Email** (best verified contact address)
- **All Discovered Emails** (comma-separated list)
- **Phone Number**
- **Website URL**
- **Physical Address**
- **Business Category**
- **Google Star Rating & Review Count**
- **Google Maps Link**
- **LinkedIn Profile**
- **Instagram Profile**
- **Facebook Page**
- **Twitter / X Handle**
- **Date Scraped**

---

## 📁 Project Directory Structure

```
email scrapping/
│
├── package.json              # Project configuration & npm scripts
├── server.js                 # Express server & API endpoints
├── start.bat                 # 1-Click Windows launcher
├── README.md                 # Documentation
│
├── src/
│   ├── scraper.js            # Orchestrates search and website crawling
│   ├── googleMaps.js         # Stealth Google Maps browser automation
│   ├── emailExtractor.js     # Fast website contact crawler & email regex parser
│   ├── exporter.js           # CSV & Excel (.xlsx) file generator
│   └── utils.js              # Helpers, user-agents, delays, URL cleaner
│
├── public/                   # Web Dashboard UI
│   ├── index.html            # User interface
│   ├── app.js                # Frontend logic & auto-download trigger
│   └── style.css             # Modern stylesheet
│
└── exports/                  # Output directory where CSV/Excel files are saved
```

---

## 💡 Email Marketing Best Practices

1. **Clean & Validate**: Before sending cold emails, consider verifying high-volume lists with MX check tools.
2. **Personalization**: Use the business name, city, and website from the CSV to personalize your email opening lines.
3. **Compliance**: Include clear unsubscribe options and follow CAN-SPAM / GDPR guidelines for cold outreach.

---

# scrappingemail

## 🌐 Deploying to Vercel

This repository is configured for deployment on Vercel (`vercel.json` + `api/index.js`).

### How to Deploy:
1. Push this repository to GitHub:
   ```bash
   git push -u origin main
   ```
2. Go to [Vercel Dashboard](https://vercel.com/dashboard) and click **"Add New Project"**.
3. Import your GitHub repository: `ahmadalibyteforceITSolution/scrappingemail`.
4. Leave framework preset as default / Other, and click **Deploy**.

## 🚀 Deploying to Render (Recommended for Cloud Puppeteer Scraping)

Render supports continuous web services and Docker containers, allowing Chromium and Puppeteer to run uninterrupted in the cloud.

### How to Deploy on Render:
1. Go to [Render Dashboard](https://dashboard.render.com/).
2. Click **"New +"** and select **"Web Service"** (or **"Blueprint"**).
3. Connect your GitHub repository: `ahmadalibyteforceITSolution/scrappingemail`.
4. Choose **Docker** as the Runtime (or Render will automatically detect `render.yaml` / `Dockerfile`).
5. Choose the **Free** instance plan.
6. Click **Create Web Service**.

Render will automatically build the Docker image with Chromium and start your dashboard server with live scraping enabled!


