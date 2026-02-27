// API Enrichment Script for AI Book
// Enriches companies.json with GitHub org data and SEC EDGAR filings
// Usage: GITHUB_TOKEN=xxx node enrich-apis.js

const fs = require('fs');
const path = require('path');
const { updateCompaniesJson } = require('./github');

// ========== GITHUB ORG MAPPING ==========
// Manual overrides for ~40 top companies where org name != lowercase company name
const GITHUB_ORG_MAP = {
  'Anthropic': 'anthropics',
  'Hugging Face': 'huggingface',
  'OpenAI': 'openai',
  'Google DeepMind': 'google-deepmind',
  'Meta AI': 'facebookresearch',
  'Microsoft': 'microsoft',
  'Stability AI': 'Stability-AI',
  'Mistral AI': 'mistralai',
  'Cohere': 'cohere-ai',
  'LangChain': 'langchain-ai',
  'LlamaIndex': 'run-llama',
  'Weights & Biases': 'wandb',
  'Lightning AI': 'Lightning-AI',
  'Runway': 'runwayml',
  'Replicate': 'replicate',
  'Modal': 'modal-labs',
  'Anyscale': 'anyscale',
  'Ray': 'ray-project',
  'Databricks': 'databricks',
  'Scale AI': 'scaleapi',
  'Snorkel AI': 'snorkel-team',
  'Determined AI': 'determined-ai',
  'Weights': 'wandb',
  'Pinecone': 'pinecone-io',
  'Weaviate': 'weaviate',
  'Qdrant': 'qdrant',
  'Chroma': 'chroma-core',
  'Milvus': 'milvus-io',
  'dbt Labs': 'dbt-labs',
  'Airbyte': 'airbytehq',
  'Prefect': 'PrefectHQ',
  'Dagster': 'dagster-io',
  'Great Expectations': 'great-expectations',
  'Cursor': 'getcursor',
  'Replit': 'replit',
  'Codeium': 'Exafunction',
  'Together AI': 'togethercomputer',
  'Perplexity': 'perplexity-ai',
  'Jasper': 'jasper-ai',
  'Character.AI': 'character-ai',
  'Inflection AI': 'InflectionAI',
  'Adept AI': 'adept-ai',
  'AI21 Labs': 'AI21Labs',
  'Cerebras': 'Cerebras',
  'SambaNova': 'sambanova',
  'Groq': 'groq',
  'xAI': 'xai-org',
  'DeepSeek': 'deepseek-ai',
  'Nous Research': 'NousResearch',
  'EleutherAI': 'EleutherAI',
};

const GITHUB_API = 'https://api.github.com';
const SEC_SEARCH_API = 'https://efts.sec.gov/LATEST/search-index';
const SEC_SUBMISSIONS_API = 'https://data.sec.gov/submissions';
const SEC_USER_AGENT = 'AI-Book-Tracker/1.0 jjshay@gmail.com';

const STALE_DAYS = 7; // Refresh GitHub data older than this

function getGitHubHeaders() {
  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function getSECHeaders() {
  return { 'User-Agent': SEC_USER_AGENT, 'Accept': 'application/json' };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isStale(isoDate, days) {
  if (!isoDate) return true;
  const age = Date.now() - new Date(isoDate).getTime();
  return age > days * 24 * 60 * 60 * 1000;
}

// Guess GitHub org name from company name: lowercase, remove spaces/special chars
function guessOrgName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/--+/g, '-');
}

// ========== GITHUB ENRICHMENT ==========

async function checkGitHubOrg(org) {
  const res = await fetch(`${GITHUB_API}/orgs/${org}`, {
    headers: getGitHubHeaders(),
  });
  return res.ok;
}

async function fetchGitHubRepos(org) {
  const res = await fetch(
    `${GITHUB_API}/orgs/${org}/repos?per_page=10&sort=stars&direction=desc`,
    { headers: getGitHubHeaders() }
  );
  if (!res.ok) return null;
  const repos = await res.json();
  const top3 = repos.slice(0, 3).map(r => ({
    name: r.name,
    stars: r.stargazers_count,
    language: r.language,
  }));
  const totalStars = repos.reduce((sum, r) => sum + r.stargazers_count, 0);

  // Get last push date from the most recently pushed repo
  let lastPush = null;
  if (repos.length > 0) {
    const sorted = [...repos].sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));
    lastPush = sorted[0].pushed_at;
  }

  return { repos: top3, totalStars, lastPush, topRepoFullName: repos[0]?.full_name };
}

async function fetchWeeklyCommits(repoFullName) {
  // Returns total commits in the last 4 weeks from the stats/commit_activity endpoint
  // This endpoint returns an array of 52 weekly commit counts
  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${repoFullName}/stats/commit_activity`,
      { headers: getGitHubHeaders() }
    );
    if (!res.ok) return null;
    // GitHub may return 202 (computing) — treat as unavailable
    if (res.status === 202) return null;
    const weeks = await res.json();
    if (!Array.isArray(weeks) || weeks.length === 0) return null;
    // Sum the last 4 weeks
    const recent = weeks.slice(-4);
    const total = recent.reduce((sum, w) => sum + (w.total || 0), 0);
    return Math.round(total / 4); // average weekly commits
  } catch {
    return null;
  }
}

async function enrichGitHub(companies) {
  console.log('\n[GitHub] Starting enrichment...');
  let enriched = 0;
  let refreshed = 0;
  let skipped = 0;
  let notFound = 0;

  for (const c of companies) {
    // Skip if already enriched AND not stale
    if (c.hasOwnProperty('github_org') && !isStale(c.github_enriched_at, STALE_DAYS)) {
      skipped++;
      continue;
    }

    // If already known to have no GitHub, skip unless very stale (30 days)
    if (c.github_org === null && !isStale(c.github_enriched_at, 30)) {
      skipped++;
      continue;
    }

    const isRefresh = c.hasOwnProperty('github_org') && c.github_org !== null;
    const mappedOrg = GITHUB_ORG_MAP[c.name];
    let org = c.github_org; // Use existing org if refreshing

    if (!org) {
      if (mappedOrg) {
        const exists = await checkGitHubOrg(mappedOrg);
        if (exists) org = mappedOrg;
        await sleep(100);
      } else {
        const guess = guessOrgName(c.name);
        const exists = await checkGitHubOrg(guess);
        if (exists) org = guess;
        await sleep(100);
      }
    }

    if (org) {
      const data = await fetchGitHubRepos(org);
      await sleep(100);
      if (data) {
        // Fetch commit velocity for top repo
        let weeklyCommits = null;
        if (data.topRepoFullName) {
          weeklyCommits = await fetchWeeklyCommits(data.topRepoFullName);
          await sleep(100);
        }

        c.github_org = org;
        c.github_repos = data.repos;
        c.github_total_stars = data.totalStars;
        c.github_last_push = data.lastPush;
        c.github_weekly_commits = weeklyCommits;
        c.github_enriched_at = new Date().toISOString();

        if (isRefresh) {
          refreshed++;
          console.log(`  [~] ${c.name} → ${org} (refreshed, ${data.totalStars} stars)`);
        } else {
          enriched++;
          console.log(`  [+] ${c.name} → ${org} (${data.totalStars} stars, ${weeklyCommits ?? '?'} commits/wk)`);
        }
      } else {
        c.github_org = null;
        c.github_repos = [];
        c.github_total_stars = 0;
        c.github_last_push = null;
        c.github_weekly_commits = null;
        c.github_enriched_at = new Date().toISOString();
        notFound++;
      }
    } else {
      c.github_org = null;
      c.github_repos = [];
      c.github_total_stars = 0;
      c.github_last_push = null;
      c.github_weekly_commits = null;
      c.github_enriched_at = new Date().toISOString();
      notFound++;
    }
  }

  console.log(`[GitHub] Done: ${enriched} new, ${refreshed} refreshed, ${skipped} skipped, ${notFound} not found`);
  return enriched + refreshed;
}

// Incremental enrichment: refresh ~93 stale companies per day (652/7 = ~93)
async function enrichGitHubIncremental(companies, batchSize = 93) {
  console.log(`\n[GitHub Incremental] Refreshing up to ${batchSize} stale companies...`);
  let refreshed = 0;

  // Find companies with github_org that are stale
  const stale = companies.filter(c =>
    c.github_org && isStale(c.github_enriched_at, STALE_DAYS)
  );
  const batch = stale.slice(0, batchSize);
  console.log(`  Found ${stale.length} stale, processing ${batch.length}`);

  for (const c of batch) {
    const data = await fetchGitHubRepos(c.github_org);
    await sleep(100);
    if (data) {
      let weeklyCommits = null;
      if (data.topRepoFullName) {
        weeklyCommits = await fetchWeeklyCommits(data.topRepoFullName);
        await sleep(100);
      }
      c.github_repos = data.repos;
      c.github_total_stars = data.totalStars;
      c.github_last_push = data.lastPush;
      c.github_weekly_commits = weeklyCommits;
      c.github_enriched_at = new Date().toISOString();
      refreshed++;
    }
  }

  console.log(`[GitHub Incremental] Refreshed ${refreshed}/${batch.length}`);
  return refreshed;
}

// ========== SEC EDGAR ENRICHMENT ==========

async function searchSEC(companyName) {
  const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22&dateRange=custom&startdt=2020-01-01&enddt=2026-12-31`;
  try {
    const res = await fetch(url, { headers: getSECHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.hits && data.hits.hits && data.hits.hits.length > 0) {
      const firstHit = data.hits.hits[0]._source;
      // Extract CIK - may be in entity_id or file_num fields
      if (firstHit.entity_id) {
        return firstHit.entity_id.toString().padStart(10, '0');
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchSECSubmissions(cik) {
  const paddedCik = cik.padStart(10, '0');
  const url = `${SEC_SUBMISSIONS_API}/CIK${paddedCik}.json`;
  try {
    const res = await fetch(url, { headers: getSECHeaders() });
    if (!res.ok) return null;
    const data = await res.json();

    const recent = data.filings?.recent;
    if (!recent) return null;

    const filingCount = recent.form?.length || 0;
    let latestFiling = null;
    if (filingCount > 0) {
      latestFiling = {
        form: recent.form[0],
        date: recent.filingDate[0],
      };
    }

    return { filingCount, latestFiling };
  } catch {
    return null;
  }
}

// Alternative: use EDGAR full-text search API which is more reliable
async function searchSECFullText(companyName) {
  const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22&dateRange=custom&startdt=2020-01-01&enddt=2026-12-31&forms=10-K,10-Q,S-1,8-K`;
  try {
    const res = await fetch(url, { headers: getSECHeaders() });
    if (!res.ok) {
      // Try the company search endpoint instead
      return await searchSECCompany(companyName);
    }
    const data = await res.json();
    if (data.hits && data.hits.hits && data.hits.hits.length > 0) {
      const hit = data.hits.hits[0]._source;
      if (hit.entity_id) return hit.entity_id.toString().padStart(10, '0');
    }
    return null;
  } catch {
    return await searchSECCompany(companyName);
  }
}

async function searchSECCompany(companyName) {
  // Use the company search endpoint as fallback
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(companyName)}&CIK=&type=&dateb=&owner=include&count=1&search_text=&action=getcompany&output=atom`;
  try {
    const res = await fetch(url, { headers: getSECHeaders() });
    if (!res.ok) return null;
    const text = await res.text();
    // Extract CIK from atom feed
    const cikMatch = text.match(/CIK=(\d+)/);
    if (cikMatch) return cikMatch[1].padStart(10, '0');
    return null;
  } catch {
    return null;
  }
}

async function enrichSEC(companies) {
  console.log('\n[SEC] Starting enrichment...');
  let enriched = 0;
  let skipped = 0;
  let notFound = 0;

  for (const c of companies) {
    // Skip if already enriched
    if (c.hasOwnProperty('sec_cik')) {
      skipped++;
      continue;
    }

    const cik = await searchSECFullText(c.name);
    await sleep(150); // SEC rate limit: 10 req/sec

    if (cik) {
      const filingData = await fetchSECSubmissions(cik);
      await sleep(150);

      if (filingData) {
        c.sec_cik = cik;
        c.sec_filing_count = filingData.filingCount;
        c.sec_latest_filing = filingData.latestFiling;
        enriched++;
        console.log(`  [+] ${c.name} → CIK ${cik} (${filingData.filingCount} filings)`);
      } else {
        c.sec_cik = null;
        c.sec_filing_count = 0;
        c.sec_latest_filing = null;
        notFound++;
      }
    } else {
      c.sec_cik = null;
      c.sec_filing_count = 0;
      c.sec_latest_filing = null;
      notFound++;
    }
  }

  console.log(`[SEC] Done: ${enriched} enriched, ${skipped} skipped, ${notFound} not found`);
  return enriched;
}

// ========== GOOGLE NEWS RSS ENRICHMENT ==========

async function fetchGoogleNews(companyName) {
  const query = encodeURIComponent(`"${companyName}" AI`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AI-Book-Tracker/1.0' },
    });
    if (!res.ok) return null;
    const xml = await res.text();

    // Parse RSS XML items
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
      const itemXml = match[1];
      const title = itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')?.trim();
      const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim();
      const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim();
      const source = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')?.trim();

      if (title) {
        // Clean up title — Google News often appends " - Source Name"
        const cleanTitle = title.replace(/ - [^-]+$/, '').trim();
        items.push({
          headline: cleanTitle || title,
          url: link || null,
          source: source || null,
          date: pubDate ? new Date(pubDate).toISOString().split('T')[0] : null,
        });
      }
    }
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

async function enrichNews(companies) {
  console.log('\n[News] Starting Google News enrichment...');
  let enriched = 0;
  let skipped = 0;
  let noResults = 0;

  for (const c of companies) {
    // Skip if already enriched and not stale (refresh news every 3 days)
    if (c.recentNews && c.recentNews.length > 0 && !isStale(c.news_enriched_at, 3)) {
      skipped++;
      continue;
    }

    const news = await fetchGoogleNews(c.name);
    await sleep(200); // Be respectful to Google

    if (news) {
      c.recentNews = news;
      c.news_enriched_at = new Date().toISOString();
      enriched++;
      console.log(`  [+] ${c.name} → ${news.length} articles`);
    } else {
      c.recentNews = [];
      c.news_enriched_at = new Date().toISOString();
      noResults++;
    }
  }

  console.log(`[News] Done: ${enriched} enriched, ${skipped} skipped, ${noResults} no results`);
  return enriched;
}

// ========== WIKIDATA ENRICHMENT ==========

async function queryWikidata(companyName) {
  // SPARQL query to find company entity and extract structured data
  const sparql = `
    SELECT ?item ?itemLabel ?inception ?hqLabel ?countryLabel ?descr ?employeeCount WHERE {
      ?item rdfs:label "${companyName}"@en .
      ?item wdt:P31/wdt:P279* wd:Q4830453 .
      OPTIONAL { ?item wdt:P571 ?inception . }
      OPTIONAL { ?item wdt:P159 ?hq . }
      OPTIONAL { ?item wdt:P17 ?country . }
      OPTIONAL { ?item schema:description ?descr . FILTER(LANG(?descr) = "en") }
      OPTIONAL { ?item wdt:P1128 ?employeeCount . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    } LIMIT 1
  `;
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'AI-Book-Tracker/1.0 (jjshay@gmail.com)',
        'Accept': 'application/sparql-results+json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const bindings = data.results?.bindings;
    if (!bindings || bindings.length === 0) return null;

    const b = bindings[0];
    return {
      wikidata_id: b.item?.value?.split('/').pop() || null,
      inception: b.inception?.value?.split('T')[0] || null,
      hq: b.hqLabel?.value || null,
      country: b.countryLabel?.value || null,
      description: b.descr?.value || null,
      employeeCount: b.employeeCount?.value ? parseInt(b.employeeCount.value) : null,
    };
  } catch {
    return null;
  }
}

async function enrichWikidata(companies) {
  console.log('\n[Wikidata] Starting enrichment...');
  let enriched = 0;
  let skipped = 0;
  let notFound = 0;

  for (const c of companies) {
    // Skip if already enriched
    if (c.hasOwnProperty('wikidata_id')) {
      skipped++;
      continue;
    }

    const wiki = await queryWikidata(c.name);
    await sleep(200); // Be respectful to Wikidata

    if (wiki && wiki.wikidata_id) {
      c.wikidata_id = wiki.wikidata_id;

      // Fill gaps only — don't overwrite existing data
      if (!c.founded && wiki.inception) {
        const year = parseInt(wiki.inception.split('-')[0]);
        if (year > 1900 && year <= 2026) c.founded = year;
      }
      if (!c.hq && wiki.hq) {
        c.hq = wiki.hq;
      }
      if (!c.description && wiki.description) {
        c.description = wiki.description;
      }

      enriched++;
      const filled = [];
      if (wiki.inception) filled.push('founded');
      if (wiki.hq) filled.push('hq');
      if (wiki.description) filled.push('desc');
      console.log(`  [+] ${c.name} → ${wiki.wikidata_id} (${filled.join(', ') || 'id only'})`);
    } else {
      c.wikidata_id = null;
      notFound++;
    }
  }

  console.log(`[Wikidata] Done: ${enriched} enriched, ${skipped} skipped, ${notFound} not found`);
  return enriched;
}

// ========== LOAD COMPANIES ==========

async function loadCompanies() {
  // Try local file first (works for local runs and GitHub Actions checkout)
  const localPath = path.resolve(__dirname, '..', 'companies.json');
  if (fs.existsSync(localPath)) {
    console.log(`Loading from local file: ${localPath}`);
    return JSON.parse(fs.readFileSync(localPath, 'utf-8'));
  }
  // Fallback: fetch from raw GitHub URL (file too large for Contents API)
  console.log('Local file not found, fetching from GitHub raw URL...');
  const res = await fetch('https://raw.githubusercontent.com/jjshay/ai-book/main/companies.json');
  if (!res.ok) throw new Error(`Failed to fetch companies.json: ${res.status}`);
  return res.json();
}

function saveCompaniesLocal(companies) {
  const localPath = path.resolve(__dirname, '..', 'companies.json');
  fs.writeFileSync(localPath, JSON.stringify(companies, null, 2));
  console.log(`Saved ${companies.length} companies to ${localPath}`);
}

// ========== MAIN ==========

async function main() {
  console.log('=== AI Book API Enrichment ===');
  console.log(`Time: ${new Date().toISOString()}`);

  const companies = await loadCompanies();
  console.log(`Loaded ${companies.length} companies`);

  let totalChanges = 0;

  // GitHub enrichment
  const ghChanges = await enrichGitHub(companies);
  totalChanges += ghChanges;

  // SEC EDGAR enrichment
  const secChanges = await enrichSEC(companies);
  totalChanges += secChanges;

  // Google News enrichment
  const newsChanges = await enrichNews(companies);
  totalChanges += newsChanges;

  // Wikidata enrichment
  const wikiChanges = await enrichWikidata(companies);
  totalChanges += wikiChanges;

  // Save results
  if (totalChanges > 0) {
    // Always save locally
    saveCompaniesLocal(companies);

    // In CI (GitHub Actions), also push via API
    if (process.env.CI) {
      console.log(`Pushing ${totalChanges} enrichment changes to GitHub...`);
      await updateCompaniesJson(companies, [
        { action: 'api-enrichment', company: `${ghChanges} GitHub + ${secChanges} SEC + ${newsChanges} News + ${wikiChanges} Wikidata` },
      ]);
    }
    console.log('Done!');
  } else {
    console.log('\nNo new enrichment data to push.');
  }
}

// If run directly, execute main()
if (require.main === module) {
  main().catch(err => {
    console.error('Enrichment failed:', err.message);
    process.exit(1);
  });
}

// Export for use by server.js
module.exports = { enrichGitHub, enrichGitHubIncremental, loadCompanies, saveCompaniesLocal };
