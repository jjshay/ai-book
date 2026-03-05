#!/usr/bin/env node
// Focused script: fetch github_weekly_commits for companies that have github_org but missing commits
// Usage: GITHUB_TOKEN=xxx node enrich-commits.js

const fs = require('fs');
const path = require('path');

const GITHUB_API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN || '';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function getHeaders() {
  const h = { 'Accept': 'application/vnd.github.v3+json' };
  if (TOKEN) h['Authorization'] = `token ${TOKEN}`;
  return h;
}

async function fetchWeeklyCommits(repoFullName) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${GITHUB_API}/repos/${repoFullName}/stats/commit_activity`, { headers: getHeaders() });
      if (res.status === 202) { await sleep(2500); continue; }
      if (res.status === 403) {
        const resetAt = res.headers.get('x-ratelimit-reset');
        if (resetAt) {
          const waitMs = (parseInt(resetAt) * 1000) - Date.now() + 1000;
          if (waitMs > 0 && waitMs < 120000) {
            console.log(`    Rate limited, waiting ${Math.round(waitMs/1000)}s...`);
            await sleep(waitMs);
            continue;
          }
        }
        return null;
      }
      if (!res.ok) return null;
      const weeks = await res.json();
      if (!Array.isArray(weeks) || weeks.length === 0) return null;
      const recent = weeks.slice(-4);
      return Math.round(recent.reduce((s, w) => s + (w.total || 0), 0) / 4);
    } catch { return null; }
  }
  return null;
}

async function fetchTopRepos(org) {
  const res = await fetch(`${GITHUB_API}/orgs/${org}/repos?per_page=5&sort=stars&direction=desc`, { headers: getHeaders() });
  if (!res.ok) return [];
  const repos = await res.json();
  return repos.slice(0, 3).map(r => r.full_name);
}

async function main() {
  console.log('=== GitHub Weekly Commits Enrichment ===');
  if (!TOKEN) { console.error('Set GITHUB_TOKEN'); process.exit(1); }

  // Check rate limit
  const rlRes = await fetch(`${GITHUB_API}/rate_limit`, { headers: getHeaders() });
  const rl = await rlRes.json();
  console.log(`Rate limit: ${rl.rate.remaining}/${rl.rate.limit} (resets ${new Date(rl.rate.reset * 1000).toLocaleTimeString()})`);

  const companiesPath = path.resolve(__dirname, '..', 'companies.json');
  const companies = JSON.parse(fs.readFileSync(companiesPath, 'utf-8'));

  const needs = companies.filter(c => c.github_org && c.github_weekly_commits == null);
  console.log(`${needs.length} companies need weekly commits`);

  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < needs.length; i++) {
    const c = needs[i];
    process.stdout.write(`  [${i+1}/${needs.length}] ${c.name} (${c.github_org})... `);

    // Get top repos for this org
    let repos;
    if (Array.isArray(c.github_repos) && c.github_repos.length > 0 && c.github_repos[0].name) {
      repos = c.github_repos.slice(0, 3).map(r => `${c.github_org}/${r.name}`);
    } else {
      repos = await fetchTopRepos(c.github_org);
      await sleep(100);
    }

    if (repos.length === 0) {
      console.log('no repos');
      failed++;
      continue;
    }

    let total = 0;
    for (const repo of repos) {
      const commits = await fetchWeeklyCommits(repo);
      if (commits) total += commits;
      await sleep(120); // ~8 req/sec to stay well under 5000/hr
    }

    if (total > 0) {
      c.github_weekly_commits = total;
      enriched++;
      console.log(`${total} commits/wk`);
    } else {
      c.github_weekly_commits = 0;
      enriched++;
      console.log('0 commits/wk');
    }

    // Save every 50 companies
    if ((i + 1) % 50 === 0) {
      fs.writeFileSync(companiesPath, JSON.stringify(companies, null, 2));
      console.log(`  --- Saved checkpoint (${enriched} enriched so far) ---`);
    }
  }

  // Final save
  fs.writeFileSync(companiesPath, JSON.stringify(companies, null, 2));
  console.log(`\n=== DONE: ${enriched} enriched, ${failed} failed ===`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
