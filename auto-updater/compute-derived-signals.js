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

// ========== 4A. RUNWAY ESTIMATION ==========
// Estimate months of runway remaining based on funding, age, and headcount
let runwayEstCount = 0;
companies.forEach(c => {
  if (!c.fundingValue || !c.employeeCount || c.status === 'acquired' || c.status === 'closed') return;
  const annualBurn = c.employeeCount * AVG_ANNUAL_COST_PER_EMPLOYEE;
  const ageYears = c.companyAge || ((new Date().getFullYear()) - (c.founded || 2020));
  // Companies with revenue burn less of their funding
  const revOffset = (c.revenueValue || 0) * 1e6 * 0.6; // assume 60% of revenue offsets burn
  const totalBurned = Math.max(0, (annualBurn - revOffset)) * Math.max(ageYears - 1, 1);
  const remainingFunding = Math.max(c.fundingValue - totalBurned, 0);
  c.estimatedRunwayMonths = Math.round((remainingFunding / Math.max(annualBurn - revOffset, annualBurn * 0.2)) * 12);
  c.runwayRisk = c.estimatedRunwayMonths <= 6 ? 'critical' :
                 c.estimatedRunwayMonths <= 12 ? 'low' :
                 c.estimatedRunwayMonths <= 24 ? 'moderate' : 'healthy';
  if (c.estimatedRunwayMonths <= 12) runwayEstCount++;
});
console.log(`[4A] Runway estimation: ${runwayEstCount} companies with <=12 months runway`);

// ========== 4B. LEADERSHIP STABILITY ==========
// Detect founder/CEO departures from leadership data + news
let leadershipRiskCount = 0;
const DEPARTURE_KEYWORDS = ['former', 'ex-', 'departed', 'stepped down', 'interim', 'acting', 'transition'];
companies.forEach(c => {
  c.leadershipRisk = 'stable';
  if (!c.leadership || !Array.isArray(c.leadership)) return;

  const ceoEntries = c.leadership.filter(l => l.role && /ceo|chief executive|founder/i.test(l.role));
  const ctoEntries = c.leadership.filter(l => l.role && /cto|chief technology|chief tech/i.test(l.role));

  // Check for interim/acting roles
  const hasInterim = c.leadership.some(l =>
    l.role && /interim|acting/i.test(l.role) && /ceo|cto|chief/i.test(l.role)
  );
  if (hasInterim) { c.leadershipRisk = 'transition'; leadershipRiskCount++; return; }

  // No CEO listed at all
  if (ceoEntries.length === 0 && c.employeeCount > 20) {
    c.leadershipRisk = 'no-ceo'; leadershipRiskCount++; return;
  }

  // Check news for departure signals
  if (c.recentNews && Array.isArray(c.recentNews)) {
    const depNews = c.recentNews.some(n => {
      const h = (n.headline || '').toLowerCase();
      return DEPARTURE_KEYWORDS.some(kw => h.includes(kw)) &&
             (/ceo|cto|founder|chief/i.test(h));
    });
    if (depNews) { c.leadershipRisk = 'departure-signal'; leadershipRiskCount++; }
  }
});
console.log(`[4B] Leadership risk: ${leadershipRiskCount} companies with instability signals`);

// ========== 4C. PATENT PORTFOLIO ANALYSIS ==========
// High patents + weak revenue = IP acquisition target
let patentTargetCount = 0;
companies.forEach(c => {
  c.patentSignal = 'none';
  if (!c.patents_count || c.patents_count <= 0) return;

  const hasWeakRevenue = !c.revenueValue || c.revenueValue < 10; // under $10M
  const hasStrongPatents = c.patents_count >= 5;
  const hasAIPatents = c.patents_classifications &&
    (c.patents_classifications['G06N'] || c.patents_classifications['G06F'] || c.patents_classifications['H04L']);

  if (hasStrongPatents && hasWeakRevenue) {
    c.patentSignal = 'ip-rich-revenue-poor';
    patentTargetCount++;
  } else if (hasStrongPatents && hasAIPatents) {
    c.patentSignal = 'ai-ip-portfolio';
  } else if (c.patents_count >= 3) {
    c.patentSignal = 'moderate-ip';
  }
});
console.log(`[4C] Patent targets: ${patentTargetCount} IP-rich / revenue-poor companies`);

// ========== 4D. CUSTOMER CONCENTRATION RISK ==========
// Detect single-customer dependency from customers field
let custConcCount = 0;
companies.forEach(c => {
  c.customerConcentrationRisk = 'normal';
  if (!c.customers) return;
  const custList = c.customers.split(',').map(s => s.trim()).filter(Boolean);
  if (custList.length === 1 && !/enterprise|startup|business|consumer|research/i.test(custList[0])) {
    c.customerConcentrationRisk = 'single-customer';
    custConcCount++;
  } else if (custList.length <= 2 && custList.every(s => !/enterprise|startup|business|consumer|research|lab/i.test(s))) {
    c.customerConcentrationRisk = 'concentrated';
    custConcCount++;
  }
});
console.log(`[4D] Customer concentration risk: ${custConcCount} companies`);

// ========== 4E. VALUATION COMPRESSION ==========
// Down-round signal: estimated valuation per funding dollar declining
let valCompressCount = 0;
companies.forEach(c => {
  c.valuationCompression = false;
  if (!c.valuationValue || !c.fundingValue || c.fundingValue <= 0) return;
  const ratio = c.valuationValue / (c.fundingValue / 1e6); // valuation multiple on capital
  // Healthy startups: 3-5x+. Below 2x = compression
  if (ratio < 2 && c.monthsSinceLastRound > 18) {
    c.valuationCompression = true;
    c.valuationCompressionRatio = Math.round(ratio * 100) / 100;
    valCompressCount++;
  }
});
console.log(`[4E] Valuation compression: ${valCompressCount} companies below 2x`);

// ========== 4F. ACQUIRER APPETITE INDEX ==========
// Track how often each company is named as acquirer → build appetite map
const acquirerAppetite = new Map();
companies.forEach(c => {
  if (!c.acquirers) return;
  const acqs = c.acquirers.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  acqs.forEach(a => {
    acquirerAppetite.set(a, (acquirerAppetite.get(a) || 0) + 1);
  });
});
// Also count actual acquisitions done
companies.filter(c => c.status === 'acquired' && c.acquiredBy).forEach(c => {
  const buyer = c.acquiredBy.toLowerCase().trim();
  acquirerAppetite.set(buyer, (acquirerAppetite.get(buyer) || 0) + 3); // actual deal = 3x weight
});
// For each company, compute how "hot" its potential acquirers are
companies.forEach(c => {
  c.acquirerAppetiteScore = 0;
  if (!c.acquirers) return;
  const acqs = c.acquirers.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  c.acquirerAppetiteScore = acqs.reduce((sum, a) => sum + (acquirerAppetite.get(a) || 0), 0);
});
const highAppetite = companies.filter(c => c.acquirerAppetiteScore >= 5).length;
console.log(`[4F] Acquirer appetite: ${highAppetite} companies with active acquirers (score>=5)`);

// ========== 4G. REGULATORY PRESSURE INDEX ==========
// Map categories to regulatory exposure
const REGULATORY_PRESSURE = {
  'healthcare': 12,    // FDA, HIPAA, EU AI Act high-risk
  'finance-legal': 10, // SEC, banking regs, EU AI Act high-risk
  'security': 8,       // CFIUS, export controls, national security
  'industrial': 6,     // Safety standards, CE marking, export controls
  'foundation-infra': 5, // EU AI Act foundation model rules, chip export
  'enterprise': 3,     // General GDPR, AI transparency
  'consumer-creative': 4, // Copyright, content moderation
  'dev-tools': 2       // Minimal direct regulation
};
companies.forEach(c => {
  c.regulatoryPressure = REGULATORY_PRESSURE[c.category] || 3;
  // Boost for companies operating in EU (from HQ)
  if (c.hq && /uk|london|berlin|paris|amsterdam|eu|europe|munich|stockholm|zurich/i.test(c.hq)) {
    c.regulatoryPressure += 3; // EU AI Act exposure
  }
});
console.log(`[4G] Regulatory pressure: mapped for all categories`);

// ========== 4H. GITHUB ACTIVITY DECLINE ==========
// Companies with GitHub presence but zero or very low weekly commits = engineering slowdown
let ghDeclineCount = 0;
companies.forEach(c => {
  c.githubDecline = false;
  if (!c.github_org) return;
  // Has GitHub presence but commits dropped to zero
  if (c.github_total_stars > 10 && c.github_weekly_commits === 0) {
    c.githubDecline = true;
    ghDeclineCount++;
  }
  // Or very low activity relative to star count (popular but abandoned)
  else if (c.github_total_stars > 100 && c.github_weekly_commits <= 2) {
    c.githubDecline = true;
    ghDeclineCount++;
  }
});
console.log(`[4H] GitHub decline: ${ghDeclineCount} companies with engineering slowdown`);

// ========== 4I. NEWS SENTIMENT ANALYSIS ==========
// Parse news headlines for negative sentiment signals
const NEGATIVE_NEWS_TERMS = [
  'layoff', 'lay off', 'laid off', 'cuts', 'slash', 'downsize', 'restructur',
  'struggle', 'loss', 'decline', 'shut down', 'shutdown', 'bankrupt', 'insolvent',
  'default', 'debt', 'lawsuit', 'sue', 'investig', 'scandal', 'fraud', 'probe',
  'downturn', 'pivot', 'distress', 'fail', 'collapse', 'exit', 'wind down',
  'acquisition', 'acquire', 'acqui-hire', 'merge', 'takeover', 'buyout', 'buy out'
];
const POSITIVE_NEWS_TERMS = [
  'raise', 'series', 'funding', 'launch', 'partner', 'expand', 'growth',
  'record', 'milestone', 'ipo', 'revenue', 'profit', 'contract', 'win', 'award'
];
const MA_SIGNAL_TERMS = [
  'acquisition', 'acquire', 'acqui-hire', 'merge', 'takeover', 'buyout',
  'buy out', 'strategic review', 'exploring options', 'sale process'
];
let newsSentCount = 0;
companies.forEach(c => {
  c.newsSentimentScore = 0;
  c.newsMASignal = false;
  if (!c.recentNews || !Array.isArray(c.recentNews)) return;

  let negCount = 0, posCount = 0, maCount = 0;
  c.recentNews.forEach(n => {
    const h = (n.headline || '').toLowerCase();
    NEGATIVE_NEWS_TERMS.forEach(t => { if (h.includes(t)) negCount++; });
    POSITIVE_NEWS_TERMS.forEach(t => { if (h.includes(t)) posCount++; });
    MA_SIGNAL_TERMS.forEach(t => { if (h.includes(t)) maCount++; });
  });

  c.newsSentimentScore = posCount - negCount; // negative = bad news dominates
  c.newsNegativeCount = negCount;
  c.newsPositiveCount = posCount;
  if (maCount > 0) { c.newsMASignal = true; }
  if (negCount >= 2) newsSentCount++;
});
console.log(`[4I] News sentiment: ${newsSentCount} companies with 2+ negative signals`);

// ========== 4J. INVESTOR PORTFOLIO EXIT PRESSURE ==========
// If a company's lead investors also backed companies that were recently acquired,
// those investors may be pushing for exits across their portfolio
const investorExitMap = new Map(); // investor -> count of acquired portfolio companies
companies.filter(c => c.status === 'acquired' && c.investors).forEach(c => {
  const invList = c.investors.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  invList.forEach(inv => {
    investorExitMap.set(inv, (investorExitMap.get(inv) || 0) + 1);
  });
});
let exitPressureCount = 0;
companies.forEach(c => {
  c.investorExitPressure = 0;
  if (!c.investors || c.status === 'acquired' || c.status === 'closed') return;
  const invList = c.investors.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  let pressure = 0;
  invList.forEach(inv => {
    pressure += (investorExitMap.get(inv) || 0);
    // Also check partial matches for top investor names
    for (const [key, val] of investorExitMap) {
      if ((key.includes(inv) || inv.includes(key)) && key !== inv && val > 0) {
        pressure += val;
        break;
      }
    }
  });
  c.investorExitPressure = pressure;
  if (pressure >= 3) exitPressureCount++;
});
console.log(`[4J] Investor exit pressure: ${exitPressureCount} companies with high pressure (>=3)`);

// ========== 4K. WEB TRAFFIC / TRANCO SIGNAL ==========
// Low web traffic rank (or no rank) for funded companies = adoption concerns
let webTrafficRiskCount = 0;
companies.forEach(c => {
  c.webTrafficRisk = false;
  if (!c.fundingValue || c.fundingValue < 10000000) return; // only check well-funded
  if (c.status === 'acquired' || c.status === 'closed') return;
  // No Tranco rank at all for a funded company = low web presence
  if (!c.tranco_rank || c.tranco_rank === 0) {
    if (c.fundingValue >= 50000000) { // $50M+ with no web traffic
      c.webTrafficRisk = true;
      webTrafficRiskCount++;
    }
  }
  // Very low rank (high number = lower traffic) for well-funded
  else if (c.tranco_rank > 500000 && c.fundingValue >= 100000000) {
    c.webTrafficRisk = true;
    webTrafficRiskCount++;
  }
});
console.log(`[4K] Web traffic risk: ${webTrafficRiskCount} well-funded companies with low web presence`);

// ========== 5. M&A LIKELIHOOD COMPOSITE SCORE ==========
// Combine ALL signals into a single 0-100 score
let maScoreCount = 0;
companies.forEach(c => {
  if (c.status === 'acquired' || c.status === 'closed') {
    c.maLikelihood = null; // already acquired
    return;
  }

  let score = 0;
  let factors = [];

  // --- EXISTING SIGNALS (recalibrated) ---

  // Time since last round (>24 months = higher risk)
  if (c.monthsSinceLastRound) {
    if (c.monthsSinceLastRound > 36) { score += 18; factors.push('stale-funding-36mo+'); }
    else if (c.monthsSinceLastRound > 24) { score += 10; factors.push('stale-funding-24mo+'); }
    else if (c.monthsSinceLastRound > 18) { score += 4; factors.push('aging-round'); }
  }

  // Employee growth declining
  if (c.employeeGrowth === 'declining') { score += 12; factors.push('declining-headcount'); }

  // Competitor already acquired (market consolidation)
  if (c.competitorAcquisitionRate > 30) { score += 12; factors.push('competitors-acquired'); }
  else if (c.competitorAcquisitionRate > 0) { score += 4; factors.push('some-competitors-acquired'); }

  // Low revenue multiple (undervalued)
  if (c.revenueMultiple && c.revenueMultiple < 5) { score += 8; factors.push('low-revenue-multiple'); }

  // High burn rate (low funding per employee)
  if (c.burnRateProxy && c.burnRateProxy < 100) { score += 8; factors.push('high-burn'); }

  // Small company with top-tier VC (acqui-hire target)
  if (c.employeeCount && c.employeeCount < 100 && c.topTierVCCount >= 2) {
    score += 7; factors.push('small-with-top-vcs');
  }

  // Category density (crowded market = consolidation pressure)
  if (c.categoryDensity && c.categoryDensity > 50) { score += 4; factors.push('crowded-category'); }

  // Shared investors with already-acquired companies
  if (c.sharedInvestorsWithAcquired && c.sharedInvestorsWithAcquired >= 3) {
    score += 6; factors.push('shared-investors-with-acquired');
  }

  // --- NEW SIGNAL 1: RUNWAY RISK ---
  if (c.runwayRisk === 'critical') { score += 15; factors.push('critical-runway'); }
  else if (c.runwayRisk === 'low') { score += 8; factors.push('low-runway'); }

  // --- NEW SIGNAL 2: LEADERSHIP INSTABILITY ---
  if (c.leadershipRisk === 'transition') { score += 12; factors.push('leadership-transition'); }
  else if (c.leadershipRisk === 'departure-signal') { score += 10; factors.push('founder-departure'); }
  else if (c.leadershipRisk === 'no-ceo') { score += 8; factors.push('no-ceo-listed'); }

  // --- NEW SIGNAL 3: PATENT / IP TARGET ---
  if (c.patentSignal === 'ip-rich-revenue-poor') { score += 10; factors.push('ip-acquisition-target'); }
  else if (c.patentSignal === 'ai-ip-portfolio') { score += 4; factors.push('ai-patent-portfolio'); }

  // --- NEW SIGNAL 4: CUSTOMER CONCENTRATION ---
  if (c.customerConcentrationRisk === 'single-customer') { score += 8; factors.push('single-customer-risk'); }
  else if (c.customerConcentrationRisk === 'concentrated') { score += 5; factors.push('customer-concentration'); }

  // --- NEW SIGNAL 5: VALUATION COMPRESSION ---
  if (c.valuationCompression) { score += 10; factors.push('valuation-compressed'); }

  // --- NEW SIGNAL 6: ACQUIRER APPETITE ---
  if (c.acquirerAppetiteScore >= 8) { score += 8; factors.push('hot-acquirers'); }
  else if (c.acquirerAppetiteScore >= 5) { score += 5; factors.push('active-acquirers'); }

  // --- NEW SIGNAL 7: REGULATORY PRESSURE ---
  if (c.regulatoryPressure >= 10) { score += 6; factors.push('high-regulatory-pressure'); }
  else if (c.regulatoryPressure >= 7) { score += 3; factors.push('regulatory-exposure'); }

  // --- NEW SIGNAL 8: GITHUB ACTIVITY DECLINE ---
  if (c.githubDecline) { score += 8; factors.push('github-activity-decline'); }

  // --- NEW SIGNAL 9: NEWS SENTIMENT ---
  if (c.newsMASignal) { score += 12; factors.push('ma-news-signal'); }
  if (c.newsSentimentScore <= -3) { score += 8; factors.push('negative-press'); }
  else if (c.newsSentimentScore <= -1) { score += 4; factors.push('mixed-press'); }

  // --- NEW SIGNAL 10: INVESTOR EXIT PRESSURE ---
  if (c.investorExitPressure >= 5) { score += 8; factors.push('investor-exit-pressure'); }
  else if (c.investorExitPressure >= 3) { score += 4; factors.push('investor-exit-signal'); }

  // --- NEW SIGNAL 11: WEB TRAFFIC RISK ---
  if (c.webTrafficRisk) { score += 6; factors.push('low-web-presence'); }

  // --- NEGATIVE SIGNALS (reduces score) ---

  // Mentioned as acquirer by others (acquirer, not target)
  if (c.mentionedAsAcquirerCount && c.mentionedAsAcquirerCount >= 2) {
    score -= 10; factors.push('likely-acquirer');
  }

  // High funding + high employee count = less likely to be acquired cheaply
  if (c.fundingValue > 500000000 && c.employeeCount > 1000) {
    score -= 8; factors.push('too-big-for-easy-acquisition');
  }

  // Strong positive news momentum (healthy company)
  if (c.newsSentimentScore >= 3) {
    score -= 5; factors.push('positive-momentum');
  }

  // Recent funding = not under pressure
  if (c.monthsSinceLastRound && c.monthsSinceLastRound <= 12) {
    score -= 5; factors.push('recently-funded');
  }

  // High web traffic = strong product adoption
  if (c.tranco_rank && c.tranco_rank > 0 && c.tranco_rank < 50000) {
    score -= 4; factors.push('strong-web-presence');
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

// ========== 7. VALUATION ESTIMATION ==========
// Estimate valuation for companies missing it, based on funding stage multipliers
const STAGE_MULTIPLIERS = {
  'Pre-Seed': 8, 'Seed': 6, 'Series A': 5, 'Series B': 4,
  'Series C': 3.5, 'Series D': 3, 'Series E': 2.8,
  'Series F': 2.5, 'Series G': 2.5, 'Series H': 2.5
};

let valCount = 0;
companies.forEach(c => {
  if ((c.valuation && !c.valuationEstimated) || !c.fundingValue || c.fundingValue <= 0) return;

  // Get stage from lastRoundParsed
  const stage = c.lastRoundParsed && c.lastRoundParsed.stage;
  let multiplier = 3; // default
  if (stage) {
    for (const [key, mult] of Object.entries(STAGE_MULTIPLIERS)) {
      if (stage.toLowerCase().includes(key.toLowerCase())) {
        multiplier = mult;
        break;
      }
    }
  }

  // Adjust by growth signal
  if (c.employeeGrowth === 'high-growth') multiplier *= 1.3;
  else if (c.employeeGrowth === 'declining') multiplier *= 0.7;

  // Compute range (low = 0.7x, high = 1.4x of midpoint)
  let midpoint;
  if (c.revenueValue && c.revenueValue > 0) {
    const revMultiple = c.revenueValue >= 100 ? 15 : c.revenueValue >= 50 ? 18 : c.revenueValue >= 10 ? 20 : 25;
    const revBasedVal = c.revenueValue * revMultiple;
    const fundBasedVal = c.fundingValue / 1e6 * multiplier;
    midpoint = Math.max(revBasedVal, fundBasedVal);
  } else {
    midpoint = Math.round(c.fundingValue / 1e6 * multiplier);
  }

  const low = Math.round(midpoint * 0.7);
  const high = Math.round(midpoint * 1.4);

  function fmtVal(v) {
    if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'B';
    return '$' + v + 'M';
  }

  c.valuation = fmtVal(low) + '–' + fmtVal(high);
  c.valuationValue = midpoint;
  c.valuationEstimated = true;
  valCount++;
});
console.log(`[7] Valuation estimates: ${valCount} companies (previously missing)`);

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
