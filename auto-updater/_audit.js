const data = JSON.parse(require('fs').readFileSync('companies.json','utf-8'));

// 1. lastRound - what's failing to parse?
console.log('=== UNPARSED lastRound (missing monthsSinceRound) ===');
const unparsedRound = data.filter(c => c.lastRound && !c.lastRoundParsed);
const roundPatterns = {};
unparsedRound.forEach(c => {
  const s = c.lastRound.trim();
  roundPatterns[s] = (roundPatterns[s] || 0) + 1;
});
Object.entries(roundPatterns).sort((a,b) => b[1] - a[1]).forEach(([s, n]) => {
  console.log(`  [${n}] "${s}"`);
});
const noRound = data.filter(c => !c.lastRound);
console.log('No lastRound field at all:', noRound.length);

// 2. stageEncoded - what stages are missed?
console.log('\n=== PARSED ROUND BUT NO STAGE ===');
const hasRoundNoStage = data.filter(c => c.lastRoundParsed && !c.lastRoundParsed.stage);
const stagePatterns = {};
hasRoundNoStage.forEach(c => {
  stagePatterns[c.lastRound] = (stagePatterns[c.lastRound] || 0) + 1;
});
Object.entries(stagePatterns).sort((a,b) => b[1] - a[1]).slice(0, 25).forEach(([s, n]) => {
  console.log(`  [${n}] "${s}"`);
});

// 3. Revenue - what's unparseable?
console.log('\n=== UNPARSEABLE REVENUE STRINGS ===');
const unparsedRev = data.filter(c => c.revenue && c.revenueValue === null);
const revPatterns = {};
unparsedRev.forEach(c => { revPatterns[c.revenue] = (revPatterns[c.revenue] || 0) + 1; });
Object.entries(revPatterns).sort((a,b) => b[1] - a[1]).forEach(([s, n]) => {
  console.log(`  [${n}] "${s}"`);
});
console.log('Total unparseable:', unparsedRev.length);
console.log('Empty revenue field:', data.filter(c => !c.revenue).length);

// 4. Valuation - what's unparseable?
console.log('\n=== UNPARSEABLE VALUATION STRINGS ===');
const unparsedVal = data.filter(c => c.valuation && c.valuationValue === null);
unparsedVal.forEach(c => console.log(`  "${c.valuation}"`));
console.log('Total unparseable:', unparsedVal.length);
console.log('Empty valuation field:', data.filter(c => !c.valuation).length);

// 5. Check env for API keys
console.log('\n=== API KEYS AVAILABLE ===');
const envPath = require('path').resolve(__dirname, '.env');
try {
  const env = require('fs').readFileSync(envPath, 'utf-8');
  const keys = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'SERPAPI_KEY', 'PH_TOKEN'];
  keys.forEach(k => {
    const match = env.match(new RegExp(`${k}=(.+)`));
    const val = match ? match[1].trim() : '';
    console.log(`  ${k}: ${val ? val.slice(0, 8) + '...' : 'NOT SET'}`);
  });
} catch(e) {
  console.log('  No .env file found');
}

// 6. trancoRank gaps
console.log('\n=== TRANCO RANK GAPS ===');
const noTranco = data.filter(c => !c.tranco_rank);
console.log('Missing tranco_rank:', noTranco.length);
console.log('Sample (first 10):', noTranco.slice(0, 10).map(c => c.name).join(', '));

// 7. githubWeeklyCommits
console.log('\n=== GITHUB WEEKLY COMMITS ===');
const hasOrg = data.filter(c => c.github_org);
const hasCommits = data.filter(c => c.github_weekly_commits);
console.log('Has github_org:', hasOrg.length);
console.log('Has github_weekly_commits:', hasCommits.length);
console.log('Gap:', hasOrg.length - hasCommits.length, 'orgs without commit data');
