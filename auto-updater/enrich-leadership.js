// Leadership Enrichment Script for AI Radar
// Seeds companies.json with leadership arrays (CEO, CTO, COO, etc.) via multiple LLM providers
// Usage:
//   node enrich-leadership.js --model=claude     (default)
//   node enrich-leadership.js --model=openai
//   node enrich-leadership.js --model=gemini
//   node enrich-leadership.js --model=grok
//   node enrich-leadership.js --model=all         (consensus: runs all 4, keeps names 2+ agree on)
//   Add --dry-run to preview without saving
//   Add --force to re-enrich companies that already have leadership data
//   Add --enrich-dates-only to re-enrich companies missing startDate values
//   Add --enrich-employees to also run employee growth enrichment
//   Add --enrich-employees-only to run ONLY employee growth enrichment

const fs = require('fs');
const path = require('path');

const BATCH_SIZE = 20;
const ROLES = ['CEO', 'CFO', 'CTO', 'COO', 'CPO'];

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

Format: {"CompanyName": [{"role": "CEO", "name": "Full Name", "startDate": "YYYY-MM"}, ...], ...}

Rules:
- Include every role where you have a reasonable belief about the current holder
- For "startDate", provide the approximate month they started in that role (YYYY-MM format). Use null if unknown.
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
  const votes = {}; // "role::normalizedName" -> { role, name, startDate, count, providers }
  for (const [provider, parsed] of Object.entries(resultsByProvider)) {
    const leaders = parsed[companyName];
    if (!Array.isArray(leaders)) continue;
    for (const l of leaders) {
      if (!l.role || !l.name) continue;
      const key = `${l.role}::${l.name.toLowerCase().trim()}`;
      if (!votes[key]) {
        votes[key] = { role: l.role, name: l.name, startDate: l.startDate || null, count: 0, providers: [] };
      }
      // Prefer a startDate over null
      if (l.startDate && !votes[key].startDate) votes[key].startDate = l.startDate;
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
    .map(v => {
      const entry = { role: v.role, name: v.name };
      if (v.startDate) entry.startDate = v.startDate;
      return entry;
    });
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

  const datesOnly = process.argv.includes('--enrich-dates-only');

  const needsEnrichment = force
    ? companies
    : datesOnly
      ? companies.filter(c => c.leadership && c.leadership.length > 0 && c.leadership.some(l => !l.startDate))
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

    let prompt;
    if (datesOnly) {
      // Date-focused prompt: include existing leadership so LLM only needs to add dates
      const companyList = batch.map(c => {
        const leaders = (c.leadership || []).map(l => `${l.role}: ${l.name}`).join(', ');
        return `- ${c.name} (${c.product || 'AI company'}) [current team: ${leaders}]`;
      }).join('\n');
      prompt = `For each AI/tech company and their known executives below, determine when each person started in their current role.

Return ONLY valid JSON — no markdown, no backticks, no commentary.

Format: {"CompanyName": [{"role": "CEO", "name": "Full Name", "startDate": "YYYY-MM"}, ...], ...}

Rules:
- The names and roles are already confirmed — just add startDate for each
- startDate should be the approximate month they started in THAT specific role (not when they joined the company)
- Use "YYYY-MM" format (e.g., "2023-06"). Use null only if you truly cannot estimate
- For well-known executives (Sam Altman, Jensen Huang, etc.), you should know the approximate date
- Even for less-known executives, try to estimate based on when the company was at the stage they were likely hired
- Return ALL executives listed, not just ones you have dates for

Companies:
${companyList}`;
    } else {
      const companyList = batch.map(c => {
        const hint = c.ceo ? ` [known CEO: ${c.ceo}]` : '';
        return `- ${c.name} (${c.product || 'AI company'})${hint}`;
      }).join('\n');
      prompt = buildPrompt(companyList);
    }

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
        leaders = Array.isArray(raw) ? raw.filter(l => l.role && l.name).map(l => {
          const entry = { role: l.role, name: l.name };
          if (l.startDate) entry.startDate = l.startDate;
          return entry;
        }) : [];
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

// ========== EMPLOYEE GROWTH ENRICHMENT ==========

const EMPLOYEE_GROWTH_BATCH = 20;

function buildEmployeeGrowthPrompt(companyList) {
  return `For each AI/tech company below, estimate their current employee count and recent growth trajectory.

Return ONLY valid JSON — no markdown, no backticks, no commentary.

Format: {"CompanyName": {"employeeCount": 500, "employeeGrowth": "growing"}, ...}

Growth categories:
- "high-growth": 40%+ year-over-year employee growth (rapidly hiring)
- "growing": 10-40% year-over-year growth (steady hiring)
- "steady": -10% to +10% (stable headcount)
- "declining": more than 10% decrease (layoffs or attrition)

Rules:
- Use your best estimate for current employee count (approximate is fine)
- If a company has a known employee hint in brackets, use it as a reference
- Base growth assessment on recent hiring activity, news about layoffs/hiring, and company trajectory
- Use null for employeeCount or employeeGrowth if you truly cannot estimate

Companies:
${companyList}`;
}

async function enrichEmployeeGrowth(companies, modelArg) {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const provider = PROVIDERS[modelArg];
  if (!provider) return 0;
  if (!KEYS[modelArg]) {
    console.log(`[Employee Growth] No API key for ${modelArg}, skipping.`);
    return 0;
  }

  const needsEnrichment = force
    ? companies
    : companies.filter(c => !c.employeeGrowth);

  console.log(`\n[Employee Growth] ${needsEnrichment.length} companies to enrich`);
  if (needsEnrichment.length === 0) return 0;

  let enriched = 0;
  for (let i = 0; i < needsEnrichment.length; i += EMPLOYEE_GROWTH_BATCH) {
    const batch = needsEnrichment.slice(i, i + EMPLOYEE_GROWTH_BATCH);
    const batchNum = Math.floor(i / EMPLOYEE_GROWTH_BATCH) + 1;
    const totalBatches = Math.ceil(needsEnrichment.length / EMPLOYEE_GROWTH_BATCH);
    console.log(`\n  Batch ${batchNum}/${totalBatches}`);

    if (dryRun) {
      console.log(`  [dry-run] Would call ${modelArg} for employee growth`);
      continue;
    }

    const companyList = batch.map(c => {
      const hint = c.employees ? ` [known: ${c.employees}]` : '';
      return `- ${c.name} (${c.product || 'AI company'})${hint}`;
    }).join('\n');

    const prompt = buildEmployeeGrowthPrompt(companyList);

    try {
      const { text, tokens } = await provider.call(prompt);
      const parsed = parseJsonResponse(text);
      console.log(`    [${modelArg}] OK (${tokens})`);

      for (const c of batch) {
        const data = parsed[c.name];
        if (data) {
          if (data.employeeCount && !c.employeeCount) {
            c.employeeCount = data.employeeCount;
            c.employee_source = modelArg;
          }
          if (data.employeeGrowth && ['high-growth', 'growing', 'steady', 'declining'].includes(data.employeeGrowth)) {
            c.employeeGrowth = data.employeeGrowth;
            c.employee_enriched_at = new Date().toISOString();
            enriched++;
            console.log(`    [+] ${c.name}: ${c.employeeCount || '?'} employees, ${c.employeeGrowth}`);
          }
        }
      }
    } catch (err) {
      console.error(`    [${modelArg}] FAIL: ${err.message}`);
    }

    await sleep(1000);
  }

  console.log(`\n[Employee Growth] Done: ${enriched} enriched`);
  return enriched;
}

// ========== CLI ==========

async function main() {
  const modelFlag = process.argv.find(a => a.startsWith('--model='));
  const model = modelFlag ? modelFlag.split('=')[1] : 'claude';

  if (!['claude', 'openai', 'gemini', 'grok', 'all'].includes(model)) {
    console.error(`Unknown model: ${model}. Use: claude, openai, gemini, grok, or all`);
    process.exit(1);
  }

  console.log('=== AI Radar Leadership Enrichment ===');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Model: ${model === 'all' ? 'ALL (consensus)' : PROVIDERS[model].label}`);

  const companies = loadCompanies();
  console.log(`Loaded ${companies.length} companies`);

  let totalChanges = 0;

  // Leadership enrichment (skip if --enrich-employees-only)
  if (!process.argv.includes('--enrich-employees-only')) {
    totalChanges += await enrichLeadership(companies, model);
  }

  // Employee growth enrichment (run if --enrich-employees or --enrich-employees-only)
  if (process.argv.includes('--enrich-employees') || process.argv.includes('--enrich-employees-only')) {
    const empModel = model === 'all' ? 'claude' : model; // Use single provider for employee growth
    totalChanges += await enrichEmployeeGrowth(companies, empModel);
  }

  if (totalChanges > 0 && !process.argv.includes('--dry-run')) {
    saveCompanies(companies);
    console.log(`\nDone! ${totalChanges} companies updated.`);
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

module.exports = { enrichLeadership, enrichEmployeeGrowth, PROVIDERS };
