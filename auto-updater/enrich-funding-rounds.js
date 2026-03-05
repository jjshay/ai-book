#!/usr/bin/env node
// Funding Rounds Enrichment Script for AI Radar
// Enriches companies.json with per-round funding data (stage, amount, date, investors)
// Usage:
//   ANTHROPIC_API_KEY=xxx node enrich-funding-rounds.js
//   Add --dry-run to preview without saving
//   Add --force to re-enrich companies that already have fundingRounds

const fs = require('fs');
const path = require('path');

const BATCH_SIZE = 15; // Smaller batches — more data per company
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function loadCompanies() {
  const p = path.resolve(__dirname, '..', 'companies.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function saveCompanies(companies) {
  if (DRY_RUN) { console.log('[DRY RUN] Would save, but skipping.'); return; }
  const p = path.resolve(__dirname, '..', 'companies.json');
  fs.writeFileSync(p, JSON.stringify(companies, null, 2));
  console.log(`Saved ${companies.length} companies.`);
}

function parseJsonResponse(text) {
  // Strip markdown fences
  let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  // Try to find JSON object
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  clean = clean.slice(start, end + 1);
  try {
    return JSON.parse(clean);
  } catch {
    // Try fixing common issues
    try {
      // Remove trailing commas
      clean = clean.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(clean);
    } catch {
      return null;
    }
  }
}

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
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
    throw new Error(`Claude API ${res.status}: ${err}`);
  }
  const data = await res.json();
  const text = data.content[0]?.text || '';
  const tokens = data.usage?.output_tokens || 0;
  return { text, tokens };
}

async function main() {
  console.log('=== AI Radar Funding Rounds Enrichment ===');
  console.log(`Time: ${new Date().toISOString()}`);

  if (!API_KEY) {
    console.error('ERROR: Set ANTHROPIC_API_KEY environment variable');
    process.exit(1);
  }

  const companies = loadCompanies();
  console.log(`Loaded ${companies.length} companies`);

  const needsEnrichment = FORCE
    ? companies
    : companies.filter(c => !c.fundingRounds || c.fundingRounds.length === 0);

  console.log(`${needsEnrichment.length} companies need fundingRounds (${companies.length - needsEnrichment.length} already done)`);

  if (needsEnrichment.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let enriched = 0;
  let totalTokens = 0;

  for (let i = 0; i < needsEnrichment.length; i += BATCH_SIZE) {
    const batch = needsEnrichment.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(needsEnrichment.length / BATCH_SIZE);
    console.log(`\n  Batch ${batchNum}/${totalBatches} (${batch.map(c => c.name).join(', ')})`);

    if (DRY_RUN) {
      console.log('  [dry-run] Would call Claude Haiku for this batch');
      continue;
    }

    // Build prompt with context clues
    const companyList = batch.map(c => {
      const hints = [];
      if (c.funding) hints.push(`total funding: ${c.funding}`);
      if (c.lastRound) hints.push(`last round: ${c.lastRound}`);
      if (c.investors) hints.push(`known investors: ${c.investors}`);
      if (c.founded) hints.push(`founded: ${c.founded}`);
      if (c.fundingValue) hints.push(`funding value: $${Math.round(c.fundingValue / 1000000)}M`);
      return `- ${c.name} (${c.product || 'AI company'}) [${hints.join('; ')}]`;
    }).join('\n');

    const prompt = `For each AI/tech company below, provide their complete funding round history.

Return ONLY valid JSON — no markdown, no backticks, no commentary.

Format: {"CompanyName": [{"stage": "Series A", "amount": "$60M", "date": "2024-01", "investors": "a16z, Sequoia"}, ...], ...}

Rules:
- Include ALL known rounds from seed/angel through latest
- stage: "Pre-Seed", "Seed", "Series A", "Series B", etc. or "PE", "IPO", "SPAC"
- amount: Dollar amount with unit (e.g., "$60M", "$1.5B"). Use null if unknown
- date: "YYYY-MM" format. Use "YYYY" if month unknown. Use null if unknown
- investors: Comma-separated lead/notable investors for that round. Use null if unknown
- Order rounds chronologically (earliest first)
- Use the hints provided (total funding, last round, known investors) to help reconstruct the timeline
- If you only know 1-2 rounds, still include them — partial data is better than none
- Return an empty array [] if you truly have no information about a company's rounds

Companies:
${companyList}`;

    try {
      const { text, tokens } = await callClaude(prompt);
      totalTokens += tokens;
      const parsed = parseJsonResponse(text);

      if (!parsed) {
        console.log(`    FAIL: Could not parse response`);
        await sleep(1000);
        continue;
      }

      for (const c of batch) {
        // Try exact match, then case-insensitive
        let rounds = parsed[c.name];
        if (!rounds) {
          const key = Object.keys(parsed).find(k => k.toLowerCase() === c.name.toLowerCase());
          if (key) rounds = parsed[key];
        }
        if (rounds && Array.isArray(rounds) && rounds.length > 0) {
          c.fundingRounds = rounds;
          c.fundingRoundsEnrichedAt = new Date().toISOString();
          enriched++;
        }
      }

      console.log(`    OK (${tokens} tokens, ${enriched} total enriched)`);
    } catch (err) {
      console.error(`    FAIL: ${err.message}`);
    }

    // Rate limit: ~1 request per second
    await sleep(1200);
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Enriched: ${enriched} companies with fundingRounds`);
  console.log(`Tokens used: ${totalTokens} (~$${(totalTokens * 0.000001).toFixed(2)} at Haiku rates)`);

  // Show sample
  console.log('\n=== SAMPLE FUNDING ROUNDS ===');
  companies.filter(c => c.fundingRounds && c.fundingRounds.length > 0)
    .slice(0, 5).forEach(c => {
    console.log(`\n  ${c.name}: ${c.fundingRounds.length} rounds`);
    c.fundingRounds.forEach(r => {
      console.log(`    ${r.stage || '?'} ${r.amount || '?'} (${r.date || '?'}) — ${r.investors || '?'}`);
    });
  });

  saveCompanies(companies);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
