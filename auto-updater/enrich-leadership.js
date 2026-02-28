// Leadership Enrichment Script for AI Book
// Seeds companies.json with leadership arrays (CEO, CTO, COO, etc.) via multiple LLM providers
// Usage:
//   node enrich-leadership.js --model=claude     (default)
//   node enrich-leadership.js --model=openai
//   node enrich-leadership.js --model=gemini
//   node enrich-leadership.js --model=grok
//   node enrich-leadership.js --model=all         (consensus: runs all 4, keeps names 2+ agree on)
//   Add --dry-run to preview without saving
//   Add --force to re-enrich companies that already have leadership data

const fs = require('fs');
const path = require('path');

const BATCH_SIZE = 20;
const ROLES = ['CEO', 'CTO', 'COO', 'Chief Strategy Officer', 'CPO', 'CRO'];

// ========== API KEYS ==========
const KEYS = {
  claude:  process.env.ANTHROPIC_API_KEY || '',
  openai:  process.env.OPENAI_API_KEY    || '',
  gemini:  process.env.GEMINI_API_KEY    || '',
  grok:    process.env.XAI_API_KEY       || '',
};

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

function buildPrompt(companyList) {
  return `For each AI/tech company below, list their current C-suite executives. I need as many of these roles as you can find: ${ROLES.join(', ')}.

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
}

function parseJsonResponse(text) {
  const jsonStr = text.replace(/^```json\s*/m, '').replace(/```\s*$/m, '').trim();
  return JSON.parse(jsonStr);
}

// ========== PROVIDER ADAPTERS ==========

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': KEYS.claude,
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
    throw new Error(`Claude API ${res.status}: ${err.substring(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const tokens = data.usage ? `${data.usage.input_tokens} in / ${data.usage.output_tokens} out` : '';
  return { text, tokens };
}

async function callOpenAI(prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KEYS.openai}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${err.substring(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const tokens = data.usage ? `${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} out` : '';
  return { text, tokens };
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${KEYS.gemini}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 4096 },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API ${res.status}: ${err.substring(0, 200)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata;
  const tokens = usage ? `${usage.promptTokenCount} in / ${usage.candidatesTokenCount} out` : '';
  return { text, tokens };
}

async function callGrok(prompt) {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KEYS.grok}`,
    },
    body: JSON.stringify({
      model: 'grok-3-mini',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Grok API ${res.status}: ${err.substring(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const tokens = data.usage ? `${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} out` : '';
  return { text, tokens };
}

const PROVIDERS = {
  claude: { call: callClaude, label: 'Claude Haiku' },
  openai: { call: callOpenAI, label: 'GPT-4o-mini' },
  gemini: { call: callGemini, label: 'Gemini Flash' },
  grok:   { call: callGrok,   label: 'Grok 2' },
};

// ========== CONSENSUS MODE ==========

function mergeLeadership(resultsByProvider, companyName) {
  // Count how many providers agree on each role+name pair
  const votes = {}; // "role::normalizedName" -> { role, name, count, providers }
  for (const [provider, parsed] of Object.entries(resultsByProvider)) {
    const leaders = parsed[companyName];
    if (!Array.isArray(leaders)) continue;
    for (const l of leaders) {
      if (!l.role || !l.name) continue;
      const key = `${l.role}::${l.name.toLowerCase().trim()}`;
      if (!votes[key]) {
        votes[key] = { role: l.role, name: l.name, count: 0, providers: [] };
      }
      votes[key].count++;
      votes[key].providers.push(provider);
    }
  }
  // Keep entries with 2+ votes, or if only 1 provider responded keep those
  const totalProviders = Object.keys(resultsByProvider).length;
  const threshold = totalProviders > 1 ? 2 : 1;
  return Object.values(votes)
    .filter(v => v.count >= threshold)
    .sort((a, b) => b.count - a.count)
    .map(v => ({ role: v.role, name: v.name }));
}

// ========== MAIN ENRICHMENT ==========

async function enrichLeadership(companies, modelArg) {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const isAll = modelArg === 'all';
  const allProviders = Object.keys(PROVIDERS);
  // In 'all' mode, skip providers whose keys are missing or known-broken
  const providerNames = isAll
    ? allProviders.filter(p => {
        if (!KEYS[p]) return false;
        // Quick test: try a ping later; for now just include all with keys
        return true;
      })
    : [modelArg];

  // Validate keys
  for (const p of providerNames) {
    if (!KEYS[p]) {
      console.error(`[!] No API key for ${p}. Set env var or add to KEYS.`);
      process.exit(1);
    }
  }

  console.log(`\n[Leadership] Provider(s): ${providerNames.map(p => PROVIDERS[p].label).join(' + ')}`);
  if (isAll) console.log('[Leadership] Consensus mode: keeping names 2+ models agree on');

  const needsEnrichment = force
    ? companies
    : companies.filter(c => !c.leadership || c.leadership.length === 0);
  console.log(`[Leadership] ${needsEnrichment.length} companies to enrich (${companies.length - needsEnrichment.length} already done)`);

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
      console.log(`  [dry-run] Would call ${providerNames.join(' + ')} for this batch`);
      continue;
    }

    const companyList = batch.map(c => {
      const hint = c.ceo ? ` [known CEO: ${c.ceo}]` : '';
      return `- ${c.name} (${c.product || 'AI company'})${hint}`;
    }).join('\n');

    const prompt = buildPrompt(companyList);

    // Call all selected providers (in parallel for consensus mode)
    const results = {};
    if (isAll) {
      const calls = providerNames.map(async (p) => {
        try {
          const { text, tokens } = await PROVIDERS[p].call(prompt);
          const parsed = parseJsonResponse(text);
          console.log(`    [${p}] OK (${tokens})`);
          return [p, parsed];
        } catch (err) {
          console.error(`    [${p}] FAIL: ${err.message}`);
          return [p, null];
        }
      });
      const settled = await Promise.all(calls);
      for (const [p, parsed] of settled) {
        if (parsed) results[p] = parsed;
      }
    } else {
      const p = providerNames[0];
      try {
        const { text, tokens } = await PROVIDERS[p].call(prompt);
        results[p] = parseJsonResponse(text);
        console.log(`    [${p}] OK (${tokens})`);
      } catch (err) {
        console.error(`    [${p}] FAIL: ${err.message}`);
        // Fall back for batch
        for (const c of batch) {
          if (c.ceo && (!c.leadership || c.leadership.length === 0)) {
            c.leadership = [{ role: 'CEO', name: c.ceo }];
            c.leadershipEnrichedAt = new Date().toISOString();
            fallbacks++;
          }
        }
        await sleep(2000);
        continue;
      }
    }

    if (Object.keys(results).length === 0) {
      console.error(`    [!] All providers failed for batch ${batchNum}`);
      await sleep(2000);
      continue;
    }

    // Apply results
    for (const c of batch) {
      let leaders;
      if (isAll) {
        leaders = mergeLeadership(results, c.name);
      } else {
        const parsed = Object.values(results)[0];
        const raw = parsed[c.name];
        leaders = Array.isArray(raw) ? raw.filter(l => l.role && l.name).map(l => ({ role: l.role, name: l.name })) : [];
      }

      if (leaders.length > 0) {
        c.leadership = leaders;
        c.leadershipEnrichedAt = new Date().toISOString();
        c.leadershipSource = isAll ? 'consensus' : modelArg;
        enriched++;
        console.log(`    [+] ${c.name}: ${leaders.map(l => l.role).join(', ')}`);
      } else if (c.ceo) {
        c.leadership = [{ role: 'CEO', name: c.ceo }];
        c.leadershipEnrichedAt = new Date().toISOString();
        c.leadershipSource = 'fallback';
        fallbacks++;
        console.log(`    [~] ${c.name}: fallback to CEO field (${c.ceo})`);
      }
    }

    await sleep(1000);
  }

  console.log(`\n[Leadership] Done: ${enriched} enriched, ${fallbacks} CEO fallbacks`);
  return enriched + fallbacks;
}

// ========== CLI ==========

async function main() {
  const modelFlag = process.argv.find(a => a.startsWith('--model='));
  const model = modelFlag ? modelFlag.split('=')[1] : 'claude';

  if (!['claude', 'openai', 'gemini', 'grok', 'all'].includes(model)) {
    console.error(`Unknown model: ${model}. Use: claude, openai, gemini, grok, or all`);
    process.exit(1);
  }

  console.log('=== AI Book Leadership Enrichment ===');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Model: ${model === 'all' ? 'ALL (consensus)' : PROVIDERS[model].label}`);

  const companies = loadCompanies();
  console.log(`Loaded ${companies.length} companies`);

  const changes = await enrichLeadership(companies, model);

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

module.exports = { enrichLeadership, PROVIDERS };
