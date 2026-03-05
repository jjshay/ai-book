#!/usr/bin/env node
// Compute derived M&A prediction + hiring signals from existing data
// No API calls needed — pure computation

const fs = require('fs');
const path = require('path');

const companiesPath = path.resolve(__dirname, '..', 'companies.json');
const companies = JSON.parse(fs.readFileSync(companiesPath, 'utf-8'));

console.log(`=== Derived Signal Computation ===`);
console.log(`${companies.length} companies loaded\n`);

// Build lookup maps
const nameToCompany = new Map();
companies.forEach(c => nameToCompany.set(c.name.toLowerCase(), c));

const acquiredNames = new Set(
  companies.filter(c => c.status === 'acquired' || c.status === 'closed').map(c => c.name.toLowerCase())
);

// ========== 1. RUNWAY ESTIMATE ==========
// Rough: fundingValue / (employeeCount * $150k avg cost)
const AVG_ANNUAL_COST_PER_EMPLOYEE = 150000; // fully loaded

let runwayCount = 0;
companies.forEach(c => {
  if (c.fundingValue > 0 && c.employeeCount > 0) {
    const annualBurn = c.employeeCount * AVG_ANNUAL_COST_PER_EMPLOYEE;
    // Assume they've spent proportional to company age
    const ageYears = c.companyAge || ((new Date().getFullYear()) - (c.founded || 2020));
    const totalBurned = annualBurn * Math.max(ageYears - 1, 1); // rough
    const remainingFunding = Math.max(c.fundingValue - totalBurned, 0);
    const monthsRunway = Math.round((remainingFunding / annualBurn) * 12);

    // More useful: burn rate ratio (funding per employee)
    c.fundingPerEmployee = Math.round(c.fundingValue / c.employeeCount);

    // Simple runway signal: months since last round (pressure indicator)
    if (c.lastRoundParsed && c.lastRoundParsed.monthsSinceRound) {
      c.monthsSinceLastRound = c.lastRoundParsed.monthsSinceRound;
    }

    // Burn rate proxy: higher = more runway per person
    c.burnRateProxy = Math.round(c.fundingValue / c.employeeCount / 1000); // $K per employee
    runwayCount++;
  }
});
console.log(`[1] Runway/burn signals: ${runwayCount} companies`);

// ========== 2. COMPETITOR ACQUISITION RATE ==========
// What % of a company's named competitors have already been acquired?
let compAcqCount = 0;
companies.forEach(c => {
  if (!c.competitors) { c.competitorAcquisitionRate = null; return; }
  const comps = c.competitors.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (comps.length === 0) { c.competitorAcquisitionRate = null; return; }

  let acquiredCount = 0;
  comps.forEach(comp => {
    // Check if this competitor is in our tracker AND acquired
    if (acquiredNames.has(comp)) acquiredCount++;
    // Also check partial matches
    for (const [name, co] of nameToCompany) {
      if ((name.includes(comp) || comp.includes(name)) && (co.status === 'acquired' || co.status === 'closed')) {
        acquiredCount++;
        break;
      }
    }
  });

  c.competitorAcquisitionRate = Math.round((acquiredCount / comps.length) * 100); // percentage
  c.competitorsAcquiredCount = acquiredCount;
  if (acquiredCount > 0) compAcqCount++;
});
console.log(`[2] Competitor acquisition rate: ${compAcqCount} companies have acquired competitors`);

// ========== 3. FUNDING VELOCITY ==========
// How fast are they raising? Rounds per year of existence
let velCount = 0;
companies.forEach(c => {
  if (c.fundingRounds && c.fundingRounds.length > 0 && c.companyAge > 0) {
    c.fundingVelocity = Math.round((c.fundingRounds.length / c.companyAge) * 100) / 100; // rounds per year
    // Fast fundraisers (>0.5 rounds/yr) are either hot or burning cash
    velCount++;
  }
});
console.log(`[3] Funding velocity: ${velCount} companies`);

// ========== 4. INVESTOR QUALITY SCORE ==========
// Count top-tier VCs (a16z, Sequoia, etc.) backing each company
const TOP_VCS = [
  'andreessen horowitz', 'a16z', 'sequoia', 'accel', 'benchmark', 'greylock',
  'index ventures', 'lightspeed', 'general catalyst', 'khosla', 'founders fund',
  'insight partners', 'tiger global', 'coatue', 'thrive capital', 'ivp',
  'bessemer', 'redpoint', 'spark capital', 'ggv', 'menlo ventures',
  'felicis', 'first round', 'union square', 'lux capital', 'nea',
  'softbank', 'google ventures', 'gv', 'microsoft', 'nvidia', 'amazon',
  'salesforce ventures', 'intel capital', 'kleiner perkins'
];

let investorCount = 0;
companies.forEach(c => {
  if (!c.investors) return;
  const investorList = c.investors.toLowerCase();
  let topCount = 0;
  const matchedVCs = [];
  TOP_VCS.forEach(vc => {
    if (investorList.includes(vc)) {
      topCount++;
      matchedVCs.push(vc);
    }
  });
  c.topTierVCCount = topCount;
  if (topCount > 0) investorCount++;
});
console.log(`[4] Top-tier VC count: ${investorCount} companies have top-tier backing`);

// ========== 5. M&A LIKELIHOOD COMPOSITE SCORE ==========
// Combine signals into a single 0-100 score
let maScoreCount = 0;
companies.forEach(c => {
  if (c.status === 'acquired' || c.status === 'closed') {
    c.maLikelihood = null; // already acquired
    return;
  }

  let score = 0;
  let factors = [];

  // Time since last round (>24 months = higher risk)
  if (c.monthsSinceLastRound) {
    if (c.monthsSinceLastRound > 36) { score += 20; factors.push('stale-funding-36mo+'); }
    else if (c.monthsSinceLastRound > 24) { score += 12; factors.push('stale-funding-24mo+'); }
    else if (c.monthsSinceLastRound > 18) { score += 5; factors.push('aging-round'); }
  }

  // Employee growth declining
  if (c.employeeGrowth === 'declining') { score += 15; factors.push('declining-headcount'); }

  // Competitor already acquired (market consolidation)
  if (c.competitorAcquisitionRate > 30) { score += 15; factors.push('competitors-acquired'); }
  else if (c.competitorAcquisitionRate > 0) { score += 5; factors.push('some-competitors-acquired'); }

  // Low revenue multiple (undervalued)
  if (c.revenueMultiple && c.revenueMultiple < 5) { score += 10; factors.push('low-revenue-multiple'); }

  // High burn rate (low funding per employee)
  if (c.burnRateProxy && c.burnRateProxy < 100) { score += 10; factors.push('high-burn'); }

  // Small company with top-tier VC (acqui-hire target)
  if (c.employeeCount && c.employeeCount < 100 && c.topTierVCCount >= 2) {
    score += 8; factors.push('small-with-top-vcs');
  }

  // Category density (crowded market = consolidation pressure)
  if (c.categoryDensity && c.categoryDensity > 50) { score += 5; factors.push('crowded-category'); }

  // Shared investors with already-acquired companies
  if (c.sharedInvestorsWithAcquired && c.sharedInvestorsWithAcquired >= 3) {
    score += 8; factors.push('shared-investors-with-acquired');
  }

  // Mentioned as acquirer by others (acquirer, not target — negative signal)
  if (c.mentionedAsAcquirerCount && c.mentionedAsAcquirerCount >= 2) {
    score -= 10; factors.push('likely-acquirer');
  }

  // High funding + high employee count = less likely to be acquired cheaply
  if (c.fundingValue > 500000000 && c.employeeCount > 1000) {
    score -= 10; factors.push('too-big-for-easy-acquisition');
  }

  c.maLikelihood = Math.max(0, Math.min(100, score));
  c.maLikelihoodFactors = factors;
  if (score > 0) maScoreCount++;
});
console.log(`[5] M&A likelihood: ${maScoreCount} companies scored > 0`);

// ========== 6. HIRING FIT SCORE ==========
// Companies that are good job targets: growing, funded, right size
let hiringCount = 0;
companies.forEach(c => {
  if (c.status === 'acquired' || c.status === 'closed') {
    c.hiringFitScore = 0;
    return;
  }

  let score = 0;

  // Growing headcount
  if (c.employeeGrowth === 'high-growth') score += 25;
  else if (c.employeeGrowth === 'growing') score += 15;
  else if (c.employeeGrowth === 'steady') score += 5;
  else if (c.employeeGrowth === 'declining') score -= 10;

  // Revenue signal (has product-market fit)
  if (c.revenueValue >= 100) score += 15; // $100M+
  else if (c.revenueValue >= 10) score += 10; // $10M+
  else if (c.revenueValue >= 2) score += 5; // $2M+

  // Right size: not too small, not FAANG
  if (c.employeeCount >= 50 && c.employeeCount <= 5000) score += 15;
  else if (c.employeeCount >= 20 && c.employeeCount <= 10000) score += 8;

  // Well-funded (runway exists)
  if (c.fundingValue >= 50000000) score += 10;
  else if (c.fundingValue >= 10000000) score += 5;

  // Recent funding (fresh capital = hiring)
  if (c.monthsSinceLastRound && c.monthsSinceLastRound <= 12) score += 15;
  else if (c.monthsSinceLastRound && c.monthsSinceLastRound <= 24) score += 8;

  // Active GitHub (engineering culture)
  if (c.github_weekly_commits > 50) score += 5;

  // Top-tier VCs (stability)
  if (c.topTierVCCount >= 2) score += 5;

  c.hiringFitScore = Math.max(0, Math.min(100, score));
  if (score > 0) hiringCount++;
});
console.log(`[6] Hiring fit score: ${hiringCount} companies scored > 0`);

// ========== SUMMARY ==========
console.log('\n--- Top 15 M&A Likelihood ---');
companies
  .filter(c => c.maLikelihood > 0)
  .sort((a, b) => b.maLikelihood - a.maLikelihood)
  .slice(0, 15)
  .forEach(c => console.log(`  ${c.maLikelihood.toString().padStart(3)}  ${c.name.padEnd(25)} [${c.maLikelihoodFactors.join(', ')}]`));

console.log('\n--- Top 15 Hiring Fit ---');
companies
  .filter(c => c.hiringFitScore > 0)
  .sort((a, b) => b.hiringFitScore - a.hiringFitScore)
  .slice(0, 15)
  .forEach(c => console.log(`  ${c.hiringFitScore.toString().padStart(3)}  ${c.name.padEnd(25)} emp:${(c.employeeCount||'?').toString().padStart(5)} growth:${c.employeeGrowth||'?'} rev:$${c.revenueValue||0}M`));

// Save
fs.writeFileSync(companiesPath, JSON.stringify(companies, null, 2));
console.log(`\nSaved ${companies.length} companies with derived signals.`);
