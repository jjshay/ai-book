// News Enrichment Script for AI Book
// Seeds and refreshes company news headlines via Google News RSS + Claude API
// Usage:
//   Initial seed:  ANTHROPIC_API_KEY=xxx node enrich-news.js --mode=claude
//   RSS refresh:   node enrich-news.js --mode=rss
//   Both:          ANTHROPIC_API_KEY=xxx node enrich-news.js --mode=all

const fs = require('fs');
const path = require('path');

const NEWS_STALE_DAYS = 3;
const MAX_HEADLINES = 3;
const CLAUDE_BATCH_SIZE = 20; // companies per Claude call

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isStale(isoDate, days) {
  if (!isoDate) return true;
  const age = Date.now() - new Date(isoDate).getTime();
  return age > days * 24 * 60 * 60 * 1000;
}

// ========== GOOGLE NEWS RSS ==========

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

async function fetchGoogleNewsRSS(companyName) {
  const query = encodeURIComponent(`"${companyName}" AI`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AI-Book-Tracker/1.0' },
    });
    if (!res.ok) return [];
    const xml = await res.text();

    // Parse RSS items with regex (no deps needed)
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < MAX_HEADLINES) {
      const itemXml = match[1];
      const title = itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
      const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
      const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '';
      const source = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || '';

      if (title) {
        // Parse date to ISO format
        let dateStr = '';
        try {
          dateStr = new Date(pubDate).toISOString().split('T')[0];
        } catch { dateStr = ''; }

        items.push({
          headline: decodeHtmlEntities(title.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim()),
          date: dateStr,
          source: decodeHtmlEntities(source.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim()),
          url: link.trim(),
        });
      }
    }

    return items;
  } catch (err) {
    console.error(`  [!] RSS error for ${companyName}: ${err.message}`);
    return [];
  }
}

// ========== CLAUDE API SEED ==========

async function seedNewsWithClaude(companies) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[News] ANTHROPIC_API_KEY required for Claude seed mode');
    return 0;
  }

  console.log(`\n[News Claude] Seeding ${companies.length} companies in batches of ${CLAUDE_BATCH_SIZE}...`);
  let seeded = 0;

  for (let i = 0; i < companies.length; i += CLAUDE_BATCH_SIZE) {
    const batch = companies.slice(i, i + CLAUDE_BATCH_SIZE);
    const batchNum = Math.floor(i / CLAUDE_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(companies.length / CLAUDE_BATCH_SIZE);
    console.log(`  Batch ${batchNum}/${totalBatches} (${batch.map(c => c.name).join(', ')})`);

    const companyList = batch.map(c => `- ${c.name} (${c.product || 'AI company'})`).join('\n');

    const prompt = `For each company below, provide 2-3 real, notable recent news headlines (from 2024-2026) related to AI. Return ONLY valid JSON — no markdown, no backticks, no commentary.

Format: {"CompanyName": [{"headline": "...", "date": "YYYY-MM-DD", "source": "PublicationName"}], ...}

If you don't know recent news for a company, return an empty array for it.

Companies:
${companyList}`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`  [!] Claude API error: ${res.status} ${err.substring(0, 200)}`);
        await sleep(2000);
        continue;
      }

      const data = await res.json();
      const text = data.content?.[0]?.text || '';

      // Parse JSON from response (handle possible markdown wrapping)
      let parsed;
      try {
        const jsonStr = text.replace(/^```json\s*/m, '').replace(/```\s*$/m, '').trim();
        parsed = JSON.parse(jsonStr);
      } catch (parseErr) {
        console.error(`  [!] JSON parse error in batch ${batchNum}: ${parseErr.message}`);
        continue;
      }

      // Apply to companies
      for (const c of batch) {
        const news = parsed[c.name];
        if (Array.isArray(news) && news.length > 0) {
          c.recentNews = news.slice(0, MAX_HEADLINES).map(n => ({
            headline: n.headline || '',
            date: n.date || '',
            source: n.source || '',
            url: n.url || '',
          }));
          c.newsEnrichedAt = new Date().toISOString();
          seeded++;
          console.log(`    [+] ${c.name}: ${c.recentNews.length} headlines`);
        }
      }

      await sleep(1000); // Rate limit: ~1 req/sec for Haiku
    } catch (err) {
      console.error(`  [!] Claude batch error: ${err.message}`);
      await sleep(2000);
    }
  }

  console.log(`[News Claude] Seeded ${seeded} companies`);
  return seeded;
}

// ========== RSS REFRESH ==========

async function refreshNewsRSS(companies, limit = 200) {
  console.log(`\n[News RSS] Refreshing up to ${limit} stale companies...`);

  // Sort by funding (descending) to prioritize top companies
  const sortedByFunding = [...companies]
    .filter(c => c.fundingValue)
    .sort((a, b) => (b.fundingValue || 0) - (a.fundingValue || 0));

  const stale = sortedByFunding.filter(c => isStale(c.newsEnrichedAt, NEWS_STALE_DAYS));
  const batch = stale.slice(0, limit);
  console.log(`  Found ${stale.length} stale, processing ${batch.length}`);

  let refreshed = 0;

  for (const c of batch) {
    const news = await fetchGoogleNewsRSS(c.name);
    await sleep(500); // Be polite to Google

    if (news.length > 0) {
      c.recentNews = news;
      c.newsEnrichedAt = new Date().toISOString();
      refreshed++;
      console.log(`  [+] ${c.name}: ${news.length} headlines`);
    } else {
      // Keep existing news but mark as checked
      c.newsEnrichedAt = new Date().toISOString();
    }
  }

  console.log(`[News RSS] Refreshed ${refreshed}/${batch.length}`);
  return refreshed;
}

// ========== LOAD/SAVE ==========

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

// ========== MAIN ==========

async function main() {
  const mode = process.argv.includes('--mode=claude') ? 'claude'
    : process.argv.includes('--mode=rss') ? 'rss'
    : process.argv.includes('--mode=all') ? 'all'
    : 'rss';

  console.log(`=== AI Book News Enrichment (mode: ${mode}) ===`);
  console.log(`Time: ${new Date().toISOString()}`);

  const companies = loadCompanies();
  console.log(`Loaded ${companies.length} companies`);

  let totalChanges = 0;

  if (mode === 'claude' || mode === 'all') {
    // Only seed companies that don't have news yet
    const unseeded = companies.filter(c => !c.recentNews || c.recentNews.length === 0);
    console.log(`${unseeded.length} companies need Claude seeding`);
    if (unseeded.length > 0) {
      totalChanges += await seedNewsWithClaude(unseeded);
    }
  }

  if (mode === 'rss' || mode === 'all') {
    totalChanges += await refreshNewsRSS(companies);
  }

  if (totalChanges > 0) {
    saveCompanies(companies);
    console.log(`\nDone! ${totalChanges} companies updated.`);
  } else {
    console.log('\nNo news updates.');
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('News enrichment failed:', err.message);
    process.exit(1);
  });
}

module.exports = { refreshNewsRSS, seedNewsWithClaude, fetchGoogleNewsRSS };
