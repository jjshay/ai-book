#!/usr/bin/env node
// Enrich companies with job posting counts from career pages
// Tries common career page patterns: /careers, /jobs, greenhouse, lever, ashby, workable

const fs = require('fs');
const path = require('path');

const companiesPath = path.resolve(__dirname, '..', 'companies.json');
const SLEEP_MS = 300;
const STALE_DAYS = 7;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function isStale(d, days) { return !d || (Date.now() - new Date(d).getTime()) > days * 86400000; }

// Common ATS (Applicant Tracking System) board URLs
function getCareerURLs(company) {
  const urls = [];
  const domain = (company.website || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const slug = company.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const slugDash = company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');

  if (domain) {
    urls.push(`https://${domain}/careers`);
    urls.push(`https://${domain}/jobs`);
  }
  // Common ATS boards
  urls.push(`https://boards.greenhouse.io/${slug}`);
  urls.push(`https://jobs.lever.co/${slugDash}`);
  urls.push(`https://jobs.ashbyhq.com/${slugDash}`);
  urls.push(`https://${slugDash}.workable.com`);

  return urls;
}

// Count job listings from a page's HTML
function countJobsFromHTML(html, url) {
  if (!html) return 0;
  const lower = html.toLowerCase();

  // Greenhouse: count <div class="opening"> elements
  if (url.includes('greenhouse.io')) {
    const matches = html.match(/class="opening"/g);
    return matches ? matches.length : 0;
  }

  // Lever: count <div class="posting"> elements
  if (url.includes('lever.co')) {
    const matches = html.match(/class="posting"/g);
    return matches ? matches.length : 0;
  }

  // Ashby: count job listing items
  if (url.includes('ashbyhq.com')) {
    const matches = html.match(/ashby-job-posting-brief/g) || html.match(/"title":/g);
    return matches ? matches.length : 0;
  }

  // Workable: count job elements
  if (url.includes('workable.com')) {
    const matches = html.match(/data-ui="job"/g) || html.match(/class="job"/g);
    return matches ? matches.length : 0;
  }

  // Generic career page: count common job listing patterns
  const patterns = [
    /class="job[-_]?(?:listing|post|opening|card|item|row)"/gi,
    /class="position[-_]?(?:item|card|row|listing)"/gi,
    /<a[^>]*\/(?:jobs|careers|apply)\/[^"]*"[^>]*>/gi,
  ];

  let maxCount = 0;
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m.length > maxCount) maxCount = m.length;
  }

  return maxCount;
}

async function fetchCareerPage(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('application/json')) return null;
    const text = await res.text();
    return text.length > 500 ? text : null; // Skip tiny error pages
  } catch {
    return null;
  }
}

// Try Greenhouse API directly (JSON, more reliable)
async function tryGreenhouseAPI(slug) {
  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.jobs ? data.jobs.length : null;
  } catch {
    return null;
  }
}

// Try Lever API directly
async function tryLeverAPI(slug) {
  try {
    const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data.length : null;
  } catch {
    return null;
  }
}

// Try Ashby API
async function tryAshbyAPI(slug) {
  try {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.jobs ? data.jobs.length : null;
  } catch {
    return null;
  }
}

async function enrichCompany(c) {
  const slug = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const slugDash = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');

  // Try structured APIs first (most reliable)
  let jobCount = await tryGreenhouseAPI(slug);
  if (jobCount !== null) return { count: jobCount, source: 'greenhouse', board: `https://boards.greenhouse.io/${slug}` };

  jobCount = await tryGreenhouseAPI(slugDash);
  if (jobCount !== null) return { count: jobCount, source: 'greenhouse', board: `https://boards.greenhouse.io/${slugDash}` };

  jobCount = await tryLeverAPI(slugDash);
  if (jobCount !== null) return { count: jobCount, source: 'lever', board: `https://jobs.lever.co/${slugDash}` };

  jobCount = await tryLeverAPI(slug);
  if (jobCount !== null) return { count: jobCount, source: 'lever', board: `https://jobs.lever.co/${slug}` };

  jobCount = await tryAshbyAPI(slugDash);
  if (jobCount !== null) return { count: jobCount, source: 'ashby', board: `https://jobs.ashbyhq.com/${slugDash}` };

  // Fallback: try career page scraping
  const domain = (c.website || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (domain) {
    for (const path of ['/careers', '/jobs']) {
      const url = `https://${domain}${path}`;
      const html = await fetchCareerPage(url);
      if (html) {
        const count = countJobsFromHTML(html, url);
        if (count > 0) return { count, source: 'career-page', board: url };
      }
    }
  }

  return null;
}

async function main() {
  const companies = JSON.parse(fs.readFileSync(companiesPath, 'utf-8'));
  console.log(`=== Job Posting Enrichment ===`);
  console.log(`${companies.length} companies\n`);

  let enriched = 0, skipped = 0, noResults = 0;

  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];

    if (!isStale(c.jobs_enriched_at, STALE_DAYS)) {
      skipped++;
      continue;
    }

    const result = await enrichCompany(c);
    await sleep(SLEEP_MS);

    if (result) {
      c.job_count = result.count;
      c.job_source = result.source;
      c.job_board_url = result.board;
      c.jobs_enriched_at = new Date().toISOString();
      enriched++;
      if (result.count > 0) {
        console.log(`  [${i + 1}/${companies.length}] ${c.name} -> ${result.count} jobs (${result.source})`);
      }
    } else {
      c.job_count = 0;
      c.job_source = null;
      c.job_board_url = null;
      c.jobs_enriched_at = new Date().toISOString();
      noResults++;
    }

    // Checkpoint save every 50
    if ((enriched + noResults) % 50 === 0) {
      fs.writeFileSync(companiesPath, JSON.stringify(companies, null, 2));
      console.log(`  ... checkpoint saved (${enriched + noResults + skipped}/${companies.length})`);
    }
  }

  fs.writeFileSync(companiesPath, JSON.stringify(companies, null, 2));
  console.log(`\n[Jobs] Done: ${enriched} with data, ${skipped} skipped, ${noResults} no job boards found`);
  console.log(`Saved ${companies.length} companies`);
}

main().catch(console.error);
