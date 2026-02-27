// Leadership Enrichment Script for AI Book
// Seeds companies.json with leadership arrays (CEO, CTO, COO, etc.) via Claude Haiku
// Usage: ANTHROPIC_API_KEY=xxx node enrich-leadership.js
//   Dry run: ANTHROPIC_API_KEY=xxx node enrich-leadership.js --dry-run

const fs = require('fs');
const path = require('path');

const BATCH_SIZE = 20;
const ROLES = ['CEO', 'CTO', 'COO', 'Chief Strategy Officer', 'CPO', 'CRO'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadCompanies() {
  const localPath = path.resolve(__dirname, '..', 'companies.json');
  if (fs.existsSync(localPath)) {
    console.log(`Loading from: ${localPath}`);
    return JSON.parse(fs.readFileSync(localPath, 'utf-8'));
  }
  throw new Error('companies.json not found');
}

function saveCompanies(companies) {
  const localPath = path.resolve(__dirname, '..', 'companies.json');
  fs.writeFileSync(localPath, JSON.stringify(companies, null, 2));
  console.log(`Saved ${companies.length} companies to ${localPath}`);
}

async function enrichLeadership(companies) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[Leadership] ANTHROPIC_API_KEY required');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');

  // Filter to companies without leadership data
  const needsEnrichment = companies.filter(c => !c.leadership || c.leadership.length === 0);
  console.log(`\n[Leadership] ${needsEnrichment.length} companies need enrichment (${companies.length - needsEnrichment.length} already done)`);

  if (needsEnrichment.length === 0) {
    console.log('Nothing to do.');
    return 0;
  }

  let enriched = 0;
  let fallbacks = 0;

  for (let i = 0; i < needsEnrichment.length; i += BATCH_SIZE) {
    const batch = needsEnrichment.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(needsEnrichment.length / BATCH_SIZE);
    console.log(`\n  Batch ${batchNum}/${totalBatches} (${batch.map(c => c.name).join(', ')})`);

    if (dryRun) {
      console.log('  [dry-run] Would call Claude API for this batch');
      continue;
    }

    const companyList = batch.map(c => {
      const hint = c.ceo ? ` [known CEO: ${c.ceo}]` : '';
      return `- ${c.name} (${c.product || 'AI company'})${hint}`;
    }).join('\n');

    const prompt = `For each AI/tech company below, list their current C-suite executives. I need as many of these roles as you can find: ${ROLES.join(', ')}.

Most of these are well-known AI companies — you should know at least 2-3 executives for the larger ones (Anthropic, OpenAI, Databricks, Scale AI, etc.). For smaller startups, CEO + CTO is usually available.

Return ONLY valid JSON — no markdown, no backticks, no commentary.

Format: {"CompanyName": [{"role": "CEO", "name": "Full Name"}, {"role": "CTO", "name": "Full Name"}, ...], ...}

Rules:
- Include every role where you have a reasonable belief about the current holder
- If a company has a known CEO hint in brackets, confirm or correct it
- For well-known companies, you should return at LEAST 2 executives
- Use the exact company name as the key

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

      let parsed;
      try {
        const jsonStr = text.replace(/^```json\s*/m, '').replace(/```\s*$/m, '').trim();
        parsed = JSON.parse(jsonStr);
      } catch (parseErr) {
        console.error(`  [!] JSON parse error in batch ${batchNum}: ${parseErr.message}`);
        // Fall back for this batch
        for (const c of batch) {
          if (!c.leadership && c.ceo) {
            c.leadership = [{ role: 'CEO', name: c.ceo }];
            c.leadershipEnrichedAt = new Date().toISOString();
            fallbacks++;
          }
        }
        continue;
      }

      // Apply results to companies
      for (const c of batch) {
        const leaders = parsed[c.name];
        if (Array.isArray(leaders) && leaders.length > 0) {
          // Validate entries have role + name
          c.leadership = leaders
            .filter(l => l.role && l.name)
            .map(l => ({ role: l.role, name: l.name }));
          if (c.leadership.length > 0) {
            c.leadershipEnrichedAt = new Date().toISOString();
            enriched++;
            console.log(`    [+] ${c.name}: ${c.leadership.map(l => l.role).join(', ')}`);
            continue;
          }
        }
        // Fallback: use existing ceo field
        if (c.ceo) {
          c.leadership = [{ role: 'CEO', name: c.ceo }];
          c.leadershipEnrichedAt = new Date().toISOString();
          fallbacks++;
          console.log(`    [~] ${c.name}: fallback to CEO field (${c.ceo})`);
        }
      }

      // Log token usage
      const usage = data.usage;
      if (usage) {
        console.log(`    tokens: ${usage.input_tokens} in / ${usage.output_tokens} out`);
      }

      await sleep(1000);
    } catch (err) {
      console.error(`  [!] Batch error: ${err.message}`);
      // Fall back for this batch
      for (const c of batch) {
        if (!c.leadership && c.ceo) {
          c.leadership = [{ role: 'CEO', name: c.ceo }];
          c.leadershipEnrichedAt = new Date().toISOString();
          fallbacks++;
        }
      }
      await sleep(2000);
    }
  }

  console.log(`\n[Leadership] Done: ${enriched} enriched via Claude, ${fallbacks} CEO fallbacks`);
  return enriched + fallbacks;
}

async function main() {
  console.log('=== AI Book Leadership Enrichment ===');
  console.log(`Time: ${new Date().toISOString()}`);

  const companies = loadCompanies();
  console.log(`Loaded ${companies.length} companies`);

  const changes = await enrichLeadership(companies);

  if (changes > 0 && !process.argv.includes('--dry-run')) {
    saveCompanies(companies);
    console.log(`\nDone! ${changes} companies updated.`);
  } else if (process.argv.includes('--dry-run')) {
    console.log('\n[dry-run] No changes saved.');
  } else {
    console.log('\nNo changes to save.');
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Enrichment failed:', err.message);
    process.exit(1);
  });
}

module.exports = { enrichLeadership };
