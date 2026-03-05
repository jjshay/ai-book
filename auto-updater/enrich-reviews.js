#!/usr/bin/env node
// Enrich companies with Glassdoor ratings and G2 scores via SerpApi Google Search
// Usage: SERPAPI_KEY=xxx node enrich-reviews.js [--source=glassdoor|g2|both]

const fs = require('fs');
const path = require('path');

const companiesPath = path.resolve(__dirname, '..', 'companies.json');
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const SLEEP_MS = 600; // SerpApi rate limiting
const STALE_DAYS = 14; // Reviews change slowly

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function isStale(d, days) { return !d || (Date.now() - new Date(d).getTime()) > days * 86400000; }

// ========== GLASSDOOR (via SerpApi Google Search) ==========

async function fetchGlassdoor(companyName) {
  const query = `${companyName} company glassdoor rating`;
  const url = `https://serpapi.com/search?engine=google&q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}&num=5`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    // Look through organic results for Glassdoor
    const results = data.organic_results || [];
    for (const r of results) {
      if (!(r.link || '').includes('glassdoor.com')) continue;

      // Try to extract rating from snippet
      const snippet = (r.snippet || '') + ' ' + (r.rich_snippet?.top?.detected_extensions?.rating || '');
      const title = r.title || '';

      // Pattern: "3.8" or "4.2 out of 5" or "Rating: 3.5"
      let rating = null;
      const ratingMatch = snippet.match(/(\d\.\d)\s*(?:out of 5|\/5|stars?)?/i) ||
                          title.match(/(\d\.\d)\s*(?:out of 5|\/5|stars?)?/i);
      if (ratingMatch) rating = parseFloat(ratingMatch[1]);

      // Also check rich_snippet
      if (!rating && r.rich_snippet?.top?.detected_extensions?.rating) {
        rating = parseFloat(r.rich_snippet.top.detected_extensions.rating);
      }

      // Extract review count if available
      let reviewCount = null;
      const reviewMatch = snippet.match(/([\d,]+)\s*reviews?/i);
      if (reviewMatch) reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));

      if (rating && rating >= 1 && rating <= 5) {
        return {
          rating: Math.round(rating * 10) / 10,
          reviewCount,
          url: r.link,
        };
      }
    }

    // Try knowledge graph
    if (data.knowledge_graph?.rating) {
      return {
        rating: parseFloat(data.knowledge_graph.rating),
        reviewCount: data.knowledge_graph.review_count || null,
        url: null,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ========== G2 (via SerpApi Google Search) ==========

async function fetchG2(companyName) {
  const query = `${companyName} g2 reviews rating`;
  const url = `https://serpapi.com/search?engine=google&q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}&num=5`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    const results = data.organic_results || [];
    for (const r of results) {
      if (!(r.link || '').includes('g2.com')) continue;

      const snippet = (r.snippet || '') + ' ' + (r.title || '');

      let rating = null;
      const ratingMatch = snippet.match(/(\d\.\d)\s*(?:out of 5|\/5|stars?)?/i);
      if (ratingMatch) rating = parseFloat(ratingMatch[1]);

      if (!rating && r.rich_snippet?.top?.detected_extensions?.rating) {
        rating = parseFloat(r.rich_snippet.top.detected_extensions.rating);
      }

      let reviewCount = null;
      const reviewMatch = snippet.match(/([\d,]+)\s*reviews?/i);
      if (reviewMatch) reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));

      if (rating && rating >= 1 && rating <= 5) {
        return {
          rating: Math.round(rating * 10) / 10,
          reviewCount,
          url: r.link,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function main() {
  if (!SERPAPI_KEY) {
    console.error('SERPAPI_KEY required. Set it in .env or environment.');
    process.exit(1);
  }

  const source = (process.argv.find(a => a.startsWith('--source=')) || '--source=both').split('=')[1];
  const force = process.argv.includes('--force');

  const companies = JSON.parse(fs.readFileSync(companiesPath, 'utf-8'));
  console.log(`=== Review Score Enrichment (${source}) ===`);
  console.log(`${companies.length} companies\n`);

  let apiCalls = 0;

  if (source === 'glassdoor' || source === 'both') {
    console.log('[Glassdoor] Starting...');
    let enriched = 0, skipped = 0, noResults = 0;

    for (let i = 0; i < companies.length; i++) {
      const c = companies[i];
      if (!force && c.hasOwnProperty('glassdoor_rating') && !isStale(c.glassdoor_enriched_at, STALE_DAYS)) {
        skipped++;
        continue;
      }

      const data = await fetchGlassdoor(c.name);
      apiCalls++;
      await sleep(SLEEP_MS);

      if (data) {
        c.glassdoor_rating = data.rating;
        c.glassdoor_reviews = data.reviewCount;
        c.glassdoor_url = data.url;
        c.glassdoor_enriched_at = new Date().toISOString();
        enriched++;
        console.log(`  [${i + 1}] ${c.name} -> ${data.rating}/5 (${data.reviewCount || '?'} reviews)`);
      } else {
        c.glassdoor_rating = null;
        c.glassdoor_reviews = null;
        c.glassdoor_enriched_at = new Date().toISOString();
        noResults++;
      }

      // Checkpoint
      if ((enriched + noResults) % 50 === 0) {
        fs.writeFileSync(companiesPath, JSON.stringify(companies, null, 2));
        console.log(`  ... checkpoint (${enriched + noResults + skipped}/${companies.length}, ${apiCalls} API calls)`);
      }
    }
    console.log(`[Glassdoor] Done: ${enriched} rated, ${skipped} skipped, ${noResults} not found`);
  }

  if (source === 'g2' || source === 'both') {
    console.log('\n[G2] Starting...');
    let enriched = 0, skipped = 0, noResults = 0;

    for (let i = 0; i < companies.length; i++) {
      const c = companies[i];
      if (!force && c.hasOwnProperty('g2_rating') && !isStale(c.g2_enriched_at, STALE_DAYS)) {
        skipped++;
        continue;
      }

      const data = await fetchG2(c.name);
      apiCalls++;
      await sleep(SLEEP_MS);

      if (data) {
        c.g2_rating = data.rating;
        c.g2_reviews = data.reviewCount;
        c.g2_url = data.url;
        c.g2_enriched_at = new Date().toISOString();
        enriched++;
        console.log(`  [${i + 1}] ${c.name} -> ${data.rating}/5 (${data.reviewCount || '?'} reviews)`);
      } else {
        c.g2_rating = null;
        c.g2_reviews = null;
        c.g2_enriched_at = new Date().toISOString();
        noResults++;
      }

      if ((enriched + noResults) % 50 === 0) {
        fs.writeFileSync(companiesPath, JSON.stringify(companies, null, 2));
        console.log(`  ... checkpoint (${enriched + noResults + skipped}/${companies.length}, ${apiCalls} API calls)`);
      }
    }
    console.log(`[G2] Done: ${enriched} rated, ${skipped} skipped, ${noResults} not found`);
  }

  fs.writeFileSync(companiesPath, JSON.stringify(companies, null, 2));
  console.log(`\nTotal SerpApi calls: ${apiCalls}`);
  console.log(`Saved ${companies.length} companies`);
}

main().catch(console.error);
