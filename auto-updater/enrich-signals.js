// Signal Enrichment Script for AI Book
// Enriches companies.json with 5 free data sources:
//   1. Hacker News mentions (HN Algolia API)
//   2. Wikipedia page views (Wikimedia REST API)
//   3. USPTO patents (PatentsView API)
//   4. Product Hunt launches (PH website search)
//   5. OpenAlex academic papers (OpenAlex API)
//
// Usage:
//   node enrich-signals.js                        # All 5 sources
//   node enrich-signals.js --source=hn            # Single source
//   node enrich-signals.js --source=wiki --force  # Force refresh all

const fs = require('fs');
const path = require('path');

const STALE_DAYS = 7;
const SLEEP_MS = 200; // Between companies per source

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isStale(isoDate, days) {
  if (!isoDate) return true;
  const age = Date.now() - new Date(isoDate).getTime();
  return age > days * 24 * 60 * 60 * 1000;
}

function loadCompanies() {
  const localPath = path.resolve(__dirname, '..', 'companies.json');
  if (fs.existsSync(localPath)) {
    console.log(`Loading from local file: ${localPath}`);
    return JSON.parse(fs.readFileSync(localPath, 'utf-8'));
  }
  throw new Error('companies.json not found locally');
}

function saveCompanies(companies) {
  const localPath = path.resolve(__dirname, '..', 'companies.json');
  fs.writeFileSync(localPath, JSON.stringify(companies, null, 2));
  console.log(`Saved ${companies.length} companies to ${localPath}`);
}

// ========== 1. HACKER NEWS (Algolia API) ==========

async function fetchHN(companyName) {
  const query = encodeURIComponent(`"${companyName}"`);
  const url = `https://hn.algolia.com/api/v1/search?query=${query}&tags=story&hitsPerPage=5`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.nbHits) return { count: 0, topStory: null };

    let topStory = null;
    if (data.hits && data.hits.length > 0) {
      // Find highest-points story
      const best = data.hits.reduce((a, b) => (b.points > a.points ? b : a), data.hits[0]);
      topStory = {
        title: best.title,
        url: best.url || `https://news.ycombinator.com/item?id=${best.objectID}`,
        points: best.points || 0,
        date: best.created_at ? best.created_at.split('T')[0] : null,
      };
    }
    return { count: data.nbHits, topStory };
  } catch {
    return null;
  }
}

async function enrichHN(companies, force = false) {
  console.log('\n[HN] Starting Hacker News enrichment...');
  let enriched = 0, skipped = 0, noResults = 0;

  for (const c of companies) {
    if (!force && c.hasOwnProperty('hn_mentions') && !isStale(c.hn_enriched_at, STALE_DAYS)) {
      skipped++;
      continue;
    }

    const data = await fetchHN(c.name);
    await sleep(SLEEP_MS);

    if (data) {
      c.hn_mentions = data.count;
      c.hn_top_story = data.topStory;
      c.hn_enriched_at = new Date().toISOString();
      if (data.count > 0) {
        enriched++;
        console.log(`  [+] ${c.name} -> ${data.count} mentions`);
      } else {
        noResults++;
      }
    } else {
      noResults++;
    }
  }

  console.log(`[HN] Done: ${enriched} with mentions, ${skipped} skipped, ${noResults} no results`);
  return enriched;
}

// ========== 2. WIKIPEDIA PAGE VIEWS ==========

async function findWikiTitle(companyName) {
  const query = encodeURIComponent(`${companyName} artificial intelligence company`);
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${query}&format=json&srlimit=1&origin=*`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AI-Book-Tracker/1.0 (jjshay@gmail.com)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.query?.search?.length > 0) {
      return data.query.search[0].title;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchWikiPageviews(title) {
  // Get last 3 months of pageviews
  const now = new Date();
  const end = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}01`;
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const start = `${threeMonthsAgo.getFullYear()}${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}01`;
  const encoded = encodeURIComponent(title.replace(/ /g, '_'));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encoded}/monthly/${start}/${end}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AI-Book-Tracker/1.0 (jjshay@gmail.com)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.items || data.items.length === 0) return null;
    const totalViews = data.items.reduce((sum, item) => sum + (item.views || 0), 0);
    const monthlyAvg = Math.round(totalViews / data.items.length);
    return monthlyAvg;
  } catch {
    return null;
  }
}

async function enrichWikipedia(companies, force = false) {
  console.log('\n[Wiki] Starting Wikipedia pageview enrichment...');
  let enriched = 0, skipped = 0, noResults = 0;

  for (const c of companies) {
    if (!force && c.hasOwnProperty('wiki_monthly_views') && !isStale(c.wiki_enriched_at, STALE_DAYS)) {
      skipped++;
      continue;
    }

    // Step 1: Find the Wikipedia article title
    const title = await findWikiTitle(c.name);
    await sleep(SLEEP_MS);

    if (!title) {
      c.wiki_monthly_views = 0;
      c.wiki_title = null;
      c.wiki_enriched_at = new Date().toISOString();
      noResults++;
      continue;
    }

    // Step 2: Fetch pageviews
    const views = await fetchWikiPageviews(title);
    await sleep(SLEEP_MS);

    c.wiki_title = title;
    c.wiki_monthly_views = views || 0;
    c.wiki_enriched_at = new Date().toISOString();

    if (views && views > 0) {
      enriched++;
      console.log(`  [+] ${c.name} -> "${title}" ${views.toLocaleString()} views/mo`);
    } else {
      noResults++;
    }
  }

  console.log(`[Wiki] Done: ${enriched} with views, ${skipped} skipped, ${noResults} no results`);
  return enriched;
}

// ========== 3. USPTO PATENTS (PatentsView API) ==========

async function fetchPatents(companyName) {
  const url = 'https://api.patentsview.org/patents/query';
  const body = JSON.stringify({
    q: { _contains: { assignee_organization: companyName } },
    f: ['patent_title', 'patent_date', 'patent_number'],
    o: { per_page: 5, page: 1 },
    s: [{ patent_date: 'desc' }],
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const count = data.total_patent_count || 0;
    const recent = (data.patents || []).slice(0, 3).map(p => ({
      title: p.patent_title,
      date: p.patent_date,
      number: p.patent_number,
    }));
    return { count, recent };
  } catch {
    return null;
  }
}

async function enrichPatents(companies, force = false) {
  console.log('\n[Patents] Starting USPTO patent enrichment...');
  let enriched = 0, skipped = 0, noResults = 0;

  for (const c of companies) {
    if (!force && c.hasOwnProperty('patents_count') && !isStale(c.patents_enriched_at, STALE_DAYS)) {
      skipped++;
      continue;
    }

    const data = await fetchPatents(c.name);
    await sleep(SLEEP_MS);

    if (data) {
      c.patents_count = data.count;
      c.patents_recent = data.recent;
      c.patents_enriched_at = new Date().toISOString();
      if (data.count > 0) {
        enriched++;
        console.log(`  [+] ${c.name} -> ${data.count} patents`);
      } else {
        noResults++;
      }
    } else {
      c.patents_count = 0;
      c.patents_recent = [];
      c.patents_enriched_at = new Date().toISOString();
      noResults++;
    }
  }

  console.log(`[Patents] Done: ${enriched} with patents, ${skipped} skipped, ${noResults} no results`);
  return enriched;
}

// ========== 4. PRODUCT HUNT ==========

async function fetchProductHunt(companyName) {
  // Use the Product Hunt website search — public, no auth needed
  const query = encodeURIComponent(companyName);
  const url = `https://www.producthunt.com/search/posts?q=${query}`;
  try {
    // Use the PH API v2 alternatives endpoint (public)
    const apiUrl = `https://www.producthunt.com/frontend/graphql`;
    const body = JSON.stringify({
      operationName: 'SearchPostsQuery',
      variables: { query: companyName, first: 5 },
      query: `query SearchPostsQuery($query: String!, $first: Int) {
        search(query: $query, type: POST, first: $first) {
          edges {
            node {
              ... on Post {
                name
                tagline
                votesCount
                slug
                createdAt
              }
            }
          }
        }
      }`,
    });

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AI-Book-Tracker/1.0',
      },
      body,
    });

    if (!res.ok) {
      // Fallback: try scraping the search results page
      return await fetchProductHuntFallback(companyName);
    }

    const data = await res.json();
    const edges = data?.data?.search?.edges;
    if (!edges || edges.length === 0) return [];

    return edges
      .filter(e => e.node?.name)
      .map(e => ({
        name: e.node.name,
        tagline: e.node.tagline || '',
        votes: e.node.votesCount || 0,
        date: e.node.createdAt ? e.node.createdAt.split('T')[0] : null,
        url: e.node.slug ? `https://www.producthunt.com/posts/${e.node.slug}` : null,
      }));
  } catch {
    return await fetchProductHuntFallback(companyName);
  }
}

async function fetchProductHuntFallback(companyName) {
  // Simple fallback — just mark as attempted, no data
  // PH GraphQL may require auth; we gracefully degrade
  return [];
}

async function enrichProductHunt(companies, force = false) {
  console.log('\n[PH] Starting Product Hunt enrichment...');
  let enriched = 0, skipped = 0, noResults = 0;

  for (const c of companies) {
    if (!force && c.hasOwnProperty('ph_launches') && !isStale(c.ph_enriched_at, STALE_DAYS)) {
      skipped++;
      continue;
    }

    const launches = await fetchProductHunt(c.name);
    await sleep(SLEEP_MS);

    c.ph_launches = launches;
    c.ph_enriched_at = new Date().toISOString();

    if (launches.length > 0) {
      enriched++;
      console.log(`  [+] ${c.name} -> ${launches.length} launches`);
    } else {
      noResults++;
    }
  }

  console.log(`[PH] Done: ${enriched} with launches, ${skipped} skipped, ${noResults} no results`);
  return enriched;
}

// ========== 5. OPENALEX ACADEMIC PAPERS ==========

async function fetchOpenAlex(companyName) {
  const encoded = encodeURIComponent(companyName);
  const url = `https://api.openalex.org/works?filter=authorships.institutions.display_name:${encoded}&sort=cited_by_count:desc&per_page=5&mailto=jjshay@gmail.com`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AI-Book-Tracker/1.0 (jjshay@gmail.com)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const count = data.meta?.count || 0;
    const recent = (data.results || []).slice(0, 3).map(w => ({
      title: w.title || 'Untitled',
      year: w.publication_year || null,
      cited_by: w.cited_by_count || 0,
      doi: w.doi || null,
    }));
    return { count, recent };
  } catch {
    return null;
  }
}

async function enrichOpenAlex(companies, force = false) {
  console.log('\n[Papers] Starting OpenAlex enrichment...');
  let enriched = 0, skipped = 0, noResults = 0;

  for (const c of companies) {
    if (!force && c.hasOwnProperty('papers_count') && !isStale(c.papers_enriched_at, STALE_DAYS)) {
      skipped++;
      continue;
    }

    const data = await fetchOpenAlex(c.name);
    await sleep(SLEEP_MS);

    if (data) {
      c.papers_count = data.count;
      c.papers_recent = data.recent;
      c.papers_enriched_at = new Date().toISOString();
      if (data.count > 0) {
        enriched++;
        console.log(`  [+] ${c.name} -> ${data.count} papers`);
      } else {
        noResults++;
      }
    } else {
      c.papers_count = 0;
      c.papers_recent = [];
      c.papers_enriched_at = new Date().toISOString();
      noResults++;
    }
  }

  console.log(`[Papers] Done: ${enriched} with papers, ${skipped} skipped, ${noResults} no results`);
  return enriched;
}

// ========== MAIN ==========

const SOURCE_MAP = {
  hn: enrichHN,
  wiki: enrichWikipedia,
  patents: enrichPatents,
  ph: enrichProductHunt,
  papers: enrichOpenAlex,
};

async function enrichAll(companies, force = false) {
  let total = 0;
  for (const [name, fn] of Object.entries(SOURCE_MAP)) {
    try {
      const count = await fn(companies, force);
      total += count;
    } catch (err) {
      console.error(`[${name}] Error:`, err.message);
    }
  }
  return total;
}

async function main() {
  console.log('=== AI Book Signal Enrichment ===');
  console.log(`Time: ${new Date().toISOString()}`);

  // Parse CLI args
  const args = process.argv.slice(2);
  const sourceArg = args.find(a => a.startsWith('--source='))?.split('=')[1] || 'all';
  const force = args.includes('--force');

  const companies = loadCompanies();
  console.log(`Loaded ${companies.length} companies`);

  let totalChanges = 0;

  if (sourceArg === 'all') {
    totalChanges = await enrichAll(companies, force);
  } else if (SOURCE_MAP[sourceArg]) {
    totalChanges = await SOURCE_MAP[sourceArg](companies, force);
  } else {
    console.error(`Unknown source: ${sourceArg}. Valid: ${Object.keys(SOURCE_MAP).join(', ')}, all`);
    process.exit(1);
  }

  if (totalChanges > 0) {
    saveCompanies(companies);

    // In CI, push via GitHub API
    if (process.env.CI) {
      const { updateCompaniesJson } = require('./github');
      console.log(`Pushing ${totalChanges} signal enrichment changes to GitHub...`);
      await updateCompaniesJson(companies, [
        { action: 'signal-enrichment', company: `${totalChanges} signal updates (${sourceArg})` },
      ]);
    }
    console.log('Done!');
  } else {
    console.log('\nNo new signal data to push.');
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Signal enrichment failed:', err.message);
    process.exit(1);
  });
}

module.exports = { enrichAll, enrichHN, enrichWikipedia, enrichPatents, enrichProductHunt, enrichOpenAlex, SOURCE_MAP };
