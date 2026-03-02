#!/usr/bin/env node
// Export M&A Feature Matrix as CSV for modeling
// All numeric/categorical fields + acquired label (0/1)
// Usage: node export-features.js [--output path.csv]

const fs = require('fs');
const path = require('path');

const outputArg = process.argv.indexOf('--output');
const OUTPUT_PATH = outputArg !== -1 && process.argv[outputArg + 1]
  ? path.resolve(process.argv[outputArg + 1])
  : path.resolve(__dirname, '..', 'ma-features.csv');

const FILL_ZEROS = process.argv.includes('--fill-zeros');

function loadCompanies() {
  const p = path.resolve(__dirname, '..', 'companies.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// Map categorical fields to numeric
function encodeGrowth(g) {
  const map = { 'high-growth': 3, 'growing': 2, 'steady': 1, 'declining': 0 };
  return g ? (map[g] ?? '') : '';
}

function encodeStage(parsed) {
  if (!parsed || !parsed.stage) return '';
  const s = parsed.stage.toLowerCase();
  if (s.includes('pre-seed') || s === 'angel') return 0;
  if (s === 'seed') return 1;
  if (s.includes('series a')) return 2;
  if (s.includes('series b')) return 3;
  if (s.includes('series c')) return 4;
  if (s.includes('series d')) return 5;
  if (s.includes('series e') || s.includes('series f') || s.includes('series g')) return 6;
  if (s === 'pe' || s.includes('growth')) return 7;
  if (s === 'ipo' || s === 'spac' || s === 'pre-ipo') return 8;
  if (s === 'bridge' || s === 'convertible' || s === 'secondary') return 3; // treat as ~Series B equivalent
  if (s.includes('round') || s.includes('various') || s.includes('multiple')) return 4; // generic late
  return '';
}

function encodeCategory(cat) {
  const map = {
    'enterprise': 0, 'industrial': 1, 'consumer-creative': 2,
    'foundation-infra': 3, 'dev-tools': 4, 'healthcare': 5,
    'finance-legal': 6, 'security': 7
  };
  return cat ? (map[cat] ?? '') : '';
}

function main() {
  const companies = loadCompanies();
  console.log(`Loaded ${companies.length} companies`);

  // Define all feature columns
  const columns = [
    // Identity (not features, but useful for reference)
    'name',
    // Label
    'acquired',                   // 0/1
    // Numeric features — parsed
    'revenueValue',               // $M
    'valuationValue',             // $M
    'fundingValue',               // raw dollars
    'employeeCount',
    'founded',
    'companyAge',
    // Categorical features — encoded
    'employeeGrowthEncoded',      // 0=declining, 1=steady, 2=growing, 3=high-growth
    'categoryEncoded',            // 0-7
    'stageEncoded',               // 0-7 (pre-seed to PE)
    // Derived features
    'revenueMultiple',
    'burnRateProxy',
    'fundingPerEmployee',
    // Network features
    'competitorCount',
    'competitorsInTracker',
    'investorCount',
    'hasTopTierVC',               // 0/1
    'topTierVCCount',
    'acquirerPredictedCount',
    'categoryDensity',
    'investorOverlapScore',
    'topAcquirerMentionScore',
    'mentionedAsAcquirerCount',
    'sharedInvestorsWithAcquired',
    // Time features
    'monthsSinceRound',
    // Signal features (binary/count from enrichment)
    'hasGithub',                  // 0/1
    'githubWeeklyCommits',
    'githubTotalStars',
    'githubRepoCount',
    'newsCount',
    'hnMentions',
    'hasWikipedia',               // 0/1
    'wikiMonthlyViews',
    'patentCount',
    'paperCount',
    'hasAppStore',                // 0/1
    'appRating',
    'appRatingCount',
    'hasProductHunt',             // 0/1
    'hasTranco',                  // 0/1
    'trancoRank',
    'leadershipCount',
    'secFilingCount',
    'hasYC',                      // 0/1
    // Composite
    'maRiskScore',
  ];

  // Build rows
  const rows = companies.map(c => {
    const row = {};

    row.name = `"${(c.name || '').replace(/"/g, '""')}"`;
    row.acquired = c.status === 'acquired' ? 1 : 0;

    // Numeric parsed
    row.revenueValue = c.revenueValue ?? '';
    row.valuationValue = c.valuationValue ?? '';
    row.fundingValue = c.fundingValue ?? '';
    row.employeeCount = c.employeeCount ?? '';
    row.founded = c.founded ?? '';
    row.companyAge = c.companyAge ?? '';

    // Categorical encoded
    row.employeeGrowthEncoded = encodeGrowth(c.employeeGrowth);
    row.categoryEncoded = encodeCategory(c.category);
    row.stageEncoded = encodeStage(c.lastRoundParsed);

    // Derived
    row.revenueMultiple = c.revenueMultiple ?? '';
    row.burnRateProxy = c.burnRateProxy ?? '';
    row.fundingPerEmployee = c.fundingPerEmployee ?? '';

    // Network
    row.competitorCount = c.competitorCount ?? '';
    row.competitorsInTracker = c.competitorsInTracker ?? '';
    row.investorCount = c.investorCount ?? '';
    row.hasTopTierVC = c.hasTopTierVC ? 1 : 0;
    row.topTierVCCount = c.topTierVCCount ?? '';
    row.acquirerPredictedCount = c.acquirerPredictedCount ?? '';
    row.categoryDensity = c.categoryDensity ?? '';
    row.investorOverlapScore = c.investorOverlapScore ?? '';
    row.topAcquirerMentionScore = c.topAcquirerMentionScore ?? '';
    row.mentionedAsAcquirerCount = c.mentionedAsAcquirerCount ?? '';
    row.sharedInvestorsWithAcquired = c.sharedInvestorsWithAcquired ?? '';

    // Time
    row.monthsSinceRound = c.lastRoundParsed?.monthsSinceRound ?? '';

    // Signal features
    row.hasGithub = c.github_org ? 1 : 0;
    row.githubWeeklyCommits = c.github_weekly_commits ?? '';
    row.githubTotalStars = c.github_total_stars ?? '';
    row.githubRepoCount = c.github_repos ?? '';
    row.newsCount = (c.recentNews && c.recentNews.length) || 0;
    row.hnMentions = c.hn_mentions ?? '';
    row.hasWikipedia = c.wiki_title ? 1 : 0;
    row.wikiMonthlyViews = c.wiki_monthly_views ?? '';
    row.patentCount = c.patents_count ?? '';
    row.paperCount = c.papers_count ?? '';
    row.hasAppStore = c.app_name ? 1 : 0;
    row.appRating = c.app_rating ?? '';
    row.appRatingCount = c.app_rating_count ?? '';
    row.hasProductHunt = c.ph_launches ? 1 : 0;
    row.hasTranco = c.tranco_rank ? 1 : 0;
    row.trancoRank = c.tranco_rank ?? '';
    row.leadershipCount = (c.leadership && c.leadership.length) || 0;
    row.secFilingCount = c.sec_filing_count ?? '';
    row.hasYC = c.yc_batch ? 1 : 0;

    // Composite
    row.maRiskScore = c.maRiskScore ?? '';

    // Fill zeros for ML: fields where 0 is semantically valid
    if (FILL_ZEROS) {
      // "no revenue reported" → 0 is a valid floor assumption for pre-revenue
      if (row.revenueValue === '') row.revenueValue = 0;
      // "no valuation known" → keep as empty (can't assume 0)
      // "no commits" → 0 if they have a GitHub org, else leave empty
      if (row.githubWeeklyCommits === '' && row.hasGithub) row.githubWeeklyCommits = 0;
      if (row.githubWeeklyCommits === '' && !row.hasGithub) row.githubWeeklyCommits = 0;
      // "no app" → 0 rating is meaningful
      if (row.appRating === '') row.appRating = 0;
      if (row.appRatingCount === '') row.appRatingCount = 0;
      // "no tranco rank" → use a floor value (worse than all ranked sites)
      if (row.trancoRank === '') row.trancoRank = 2000000;
      // "no stage known" → -1 sentinel
      if (row.stageEncoded === '') row.stageEncoded = -1;
      // "no months since round" → median fill (36 months)
      if (row.monthsSinceRound === '') row.monthsSinceRound = 36;
      // "no burn rate" → 0
      if (row.burnRateProxy === '') row.burnRateProxy = 0;
      // "no revenue multiple" → 0
      if (row.revenueMultiple === '') row.revenueMultiple = 0;
      // "no employee count" → 0
      if (row.employeeCount === '') row.employeeCount = 0;
      if (row.employeeGrowthEncoded === '') row.employeeGrowthEncoded = 1; // assume steady
      // "no funding per employee" → 0
      if (row.fundingPerEmployee === '') row.fundingPerEmployee = 0;
      // HN mentions, SEC filings — 0 is valid
      if (row.hnMentions === '') row.hnMentions = 0;
      if (row.secFilingCount === '') row.secFilingCount = 0;
      // GitHub stars and repos
      if (row.githubTotalStars === '') row.githubTotalStars = 0;
      if (row.githubRepoCount === '') row.githubRepoCount = 0;
      // Wiki views
      if (row.wikiMonthlyViews === '') row.wikiMonthlyViews = 0;
      // Funding value
      if (row.fundingValue === '') row.fundingValue = 0;
    }

    return row;
  });

  // Write CSV
  const header = columns.join(',');
  const csvRows = rows.map(r => columns.map(col => r[col] ?? '').join(','));
  const csv = [header, ...csvRows].join('\n');

  fs.writeFileSync(OUTPUT_PATH, csv);
  console.log(`Exported ${rows.length} companies × ${columns.length} features to ${OUTPUT_PATH}`);

  // Stats
  const acq = rows.filter(r => r.acquired === 1).length;
  console.log(`Label distribution: ${acq} acquired (${Math.round(acq/rows.length*100)}%), ${rows.length - acq} non-acquired`);

  // Feature completeness
  console.log('\n=== FEATURE COMPLETENESS ===');
  columns.filter(c => c !== 'name').forEach(col => {
    const filled = rows.filter(r => r[col] !== '' && r[col] !== null && r[col] !== undefined).length;
    const pct = Math.round(filled / rows.length * 100);
    const bar = pct >= 90 ? 'OK' : pct >= 50 ? 'PARTIAL' : 'SPARSE';
    console.log(`  ${col.padEnd(30)} ${String(filled).padStart(4)}/${rows.length} (${String(pct).padStart(3)}%) ${bar}`);
  });
}

main();
