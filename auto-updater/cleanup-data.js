#!/usr/bin/env node
// Data Cleanup & Derived Fields for M&A Modeling
// Parses string fields to numeric, computes derived signals
// Usage: node cleanup-data.js [--dry-run]

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

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

// ========== REVENUE PARSER ==========
// Handles: "$50M+ ARR", "$1B+ (2024)", "$4.8B+ run-rate", "Pre-revenue", "$500K+ ARR", "$20M+ GMV"
// Returns value in millions (float), or null if unparseable/non-numeric
function parseRevenue(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();
  // Non-numeric strings
  if (/^(pre-|early|development|r&d|commercial|partnership|paused|shut|challenged|acquired|asset|was )/i.test(s)) return null;
  if (/^part of/i.test(s)) return null;

  // Match dollar amount: $4.8B+ run-rate, $50M+ ARR, $500K+ ARR
  const match = s.match(/\$?([\d,.]+)\s*(B|M|K|T)?\+?/i);
  if (!match) return null;

  let amount = parseFloat(match[1].replace(/,/g, ''));
  if (isNaN(amount)) return null;

  const unit = (match[2] || 'M').toUpperCase();
  if (unit === 'T') amount *= 1000000;   // trillion -> millions
  else if (unit === 'B') amount *= 1000; // billion -> millions
  else if (unit === 'K') amount /= 1000; // thousand -> millions
  // M stays as-is

  return Math.round(amount * 10) / 10; // 1 decimal place
}

// ========== VALUATION PARSER ==========
// Handles: "$5.2B", "$850M+", "~$10B", "$300-500M", "Undisclosed", "Bankrupt", "PE acquired (~$5.3B)"
// Returns value in millions (float), or null
function parseValuation(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();

  // Non-numeric strings
  if (/^(undisclosed|bankrupt|challenged|collapsed|acquihire|acquired|softbank|part of|public)/i.test(s)) return null;

  // Try to find any dollar amount, including inside parens: "PE acquired (~$5.3B)"
  // For ranges like "$300-500M", take the midpoint
  const rangeMatch = s.match(/\$?([\d,.]+)\s*-\s*([\d,.]+)\s*(B|M|K|T)?/i);
  if (rangeMatch) {
    const lo = parseFloat(rangeMatch[1].replace(/,/g, ''));
    const hi = parseFloat(rangeMatch[2].replace(/,/g, ''));
    const unit = (rangeMatch[3] || 'M').toUpperCase();
    let mid = (lo + hi) / 2;
    if (unit === 'T') mid *= 1000000;
    else if (unit === 'B') mid *= 1000;
    else if (unit === 'K') mid /= 1000;
    return Math.round(mid * 10) / 10;
  }

  // Standard: "$5.2B", "~$10B (Panasonic)", "$4B (challenged)", "Estimated $5B+"
  const match = s.match(/\$?([\d,.]+)\s*(B|M|K|T)?\+?/i);
  if (!match) return null;

  let amount = parseFloat(match[1].replace(/,/g, ''));
  if (isNaN(amount)) return null;

  const unit = (match[2] || 'M').toUpperCase();
  if (unit === 'T') amount *= 1000000;
  else if (unit === 'B') amount *= 1000;
  else if (unit === 'K') amount /= 1000;

  return Math.round(amount * 10) / 10;
}

// ========== LAST ROUND DATE PARSER ==========
// Handles: "Series D ($300M, May 2025)", "Series C (2024)", "Seed", "PE owned"
// Returns { stage, year, monthsSinceRound }
function parseLastRound(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();

  // Extract stage
  let stage = null;
  const stageMatch = s.match(/^(Series\s*[A-Z](\+| Extension)?|Seed|Pre-Seed|Angel|PE|Growth|Bridge|Venture|Convertible)/i);
  if (stageMatch) stage = stageMatch[0].trim();

  // Try to find year
  let year = null;
  let month = null;

  // "May 2025" or "Feb 2026" or "Nov 2025"
  const monthYearMatch = s.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i);
  if (monthYearMatch) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    month = months[monthYearMatch[1].toLowerCase()];
    year = parseInt(monthYearMatch[2]);
  } else {
    // Just a year in parens: "(2024)"
    const yearMatch = s.match(/\((\d{4})\)/);
    if (yearMatch) {
      year = parseInt(yearMatch[1]);
      month = 6; // assume mid-year
    }
  }

  if (!year) return stage ? { stage, year: null, monthsSinceRound: null } : null;

  // Calculate months since round
  const roundDate = new Date(year, month || 6);
  const now = new Date();
  const monthsSince = Math.round((now - roundDate) / (1000 * 60 * 60 * 24 * 30.44));

  return { stage, year, monthsSinceRound: Math.max(0, monthsSince) };
}

// ========== HELPER: split comma-separated field ==========
function splitField(str) {
  if (!str || typeof str !== 'string') return [];
  return str.split(',').map(s => s.trim()).filter(s => s.length > 1);
}

// ========== TOP-TIER VC LIST ==========
const TOP_TIER_VCS = new Set([
  'a16z', 'andreessen horowitz', 'sequoia', 'sequoia capital',
  'tiger global', 'y combinator', 'general catalyst', 'insight partners',
  'softbank', 'accel', 'lightspeed', 'coatue', 'gv', 'index ventures',
  'kleiner perkins', 'benchmark', 'greylock', 'khosla ventures',
  'founders fund', 'thrive capital', 'bessemer', 'bessemer venture partners',
  'ivp', 'spark capital', 'redpoint', 'wing', 'felicis', 'neo',
  'lux capital', 'durable capital', 'altimeter', 'addition',
  'greenoaks', 'iconiq', 'elad gil', 'nvidia', 'microsoft', 'google',
  'amazon', 'intel capital', 'salesforce ventures'
]);

// ========== MAIN ==========
function main() {
  const companies = loadCompanies();
  console.log(`Loaded ${companies.length} companies`);

  // ===== PASS 1: Per-company parsing & basic derived fields =====

  let revParsed = 0, revSkipped = 0;
  let valParsed = 0, valSkipped = 0;
  let roundParsed = 0;
  let derivedCount = 0;

  companies.forEach(c => {
    // --- 1. Parse revenue ---
    if (c.revenue) {
      const val = parseRevenue(c.revenue);
      if (val !== null) {
        c.revenueValue = val;
        revParsed++;
      } else {
        c.revenueValue = null;
        revSkipped++;
      }
    } else {
      c.revenueValue = null;
    }

    // --- 2. Parse valuation ---
    if (c.valuation) {
      const val = parseValuation(c.valuation);
      if (val !== null) {
        c.valuationValue = val;
        valParsed++;
      } else {
        c.valuationValue = null;
        valSkipped++;
      }
    } else {
      c.valuationValue = null;
    }

    // --- 3. Parse lastRound for time_since_last_round ---
    const roundData = parseLastRound(c.lastRound);
    if (roundData && roundData.monthsSinceRound !== null) {
      c.lastRoundParsed = {
        stage: roundData.stage,
        year: roundData.year,
        monthsSinceRound: roundData.monthsSinceRound
      };
      roundParsed++;
    } else {
      c.lastRoundParsed = null;
    }

    // --- 4. Derived: revenue_multiple ---
    if (c.valuationValue && c.revenueValue && c.revenueValue > 0) {
      c.revenueMultiple = Math.round((c.valuationValue / c.revenueValue) * 10) / 10;
    } else {
      c.revenueMultiple = null;
    }

    // --- 5. Derived: burn_rate_proxy ---
    // fundingValue is in raw dollars (e.g. 79000000 for $79M)
    const fundingRaw = c.fundingValue || null;
    const empCount = c.employeeCount || null;
    const monthsSince = c.lastRoundParsed?.monthsSinceRound;

    if (fundingRaw && empCount && monthsSince && monthsSince > 0) {
      c.burnRateProxy = Math.round(fundingRaw / empCount / monthsSince / 1000);
    } else {
      c.burnRateProxy = null;
    }

    // --- 6. Derived: company_age ---
    if (c.founded) {
      c.companyAge = new Date().getFullYear() - c.founded;
    }

    // --- 7. Derived: funding_per_employee ---
    if (fundingRaw && empCount) {
      c.fundingPerEmployee = Math.round(fundingRaw / empCount / 1000);
    } else {
      c.fundingPerEmployee = null;
    }

    if (c.revenueMultiple || c.burnRateProxy || c.fundingPerEmployee) derivedCount++;
  });

  // ===== PASS 2: Cross-company network & density signals =====
  // Build lookup indexes first

  // Name index: lowercase name → company
  const nameIndex = new Map();
  companies.forEach(c => nameIndex.set(c.name.toLowerCase(), c));

  // Category density: count per category
  const categoryCount = {};
  companies.forEach(c => {
    if (c.category) categoryCount[c.category] = (categoryCount[c.category] || 0) + 1;
  });

  // Investor portfolio index: investor name → [company names]
  const investorPortfolio = {};
  companies.forEach(c => {
    splitField(c.investors).forEach(inv => {
      const key = inv.toLowerCase();
      if (!investorPortfolio[key]) investorPortfolio[key] = [];
      investorPortfolio[key].push(c.name);
    });
  });

  // Acquirer mention index: company mentioned as acquirer → count
  const acquirerMentions = {};
  companies.forEach(c => {
    splitField(c.acquirers).forEach(acq => {
      const key = acq.toLowerCase();
      acquirerMentions[key] = (acquirerMentions[key] || 0) + 1;
    });
  });

  // "Times mentioned as acquirer" for each company in tracker
  // (i.e., how many other companies list this company as a potential acquirer)
  const mentionedAsAcquirer = {};
  companies.forEach(c => {
    splitField(c.acquirers).forEach(acq => {
      const key = acq.toLowerCase();
      if (nameIndex.has(key)) {
        mentionedAsAcquirer[key] = (mentionedAsAcquirer[key] || 0) + 1;
      }
    });
  });

  let networkCount = 0;

  companies.forEach(c => {
    const compList = splitField(c.competitors);
    const invList = splitField(c.investors);
    const acqList = splitField(c.acquirers);

    // --- 8. competitorCount ---
    c.competitorCount = compList.length;

    // --- 9. competitorsInTracker ---
    // How many of this company's named competitors are also in our 651-company tracker
    c.competitorsInTracker = compList.filter(name => nameIndex.has(name.toLowerCase())).length;

    // --- 10. investorCount ---
    c.investorCount = invList.length;

    // --- 11. hasTopTierVC ---
    // Does this company have at least one top-tier VC?
    c.hasTopTierVC = invList.some(inv => TOP_TIER_VCS.has(inv.toLowerCase()));

    // --- 12. topTierVCCount ---
    c.topTierVCCount = invList.filter(inv => TOP_TIER_VCS.has(inv.toLowerCase())).length;

    // --- 13. acquirerPredictedCount ---
    // How many distinct acquirers are predicted for this company
    c.acquirerPredictedCount = acqList.length;

    // --- 14. categoryDensity ---
    // Number of companies in the same category (competitive landscape intensity)
    c.categoryDensity = c.category ? (categoryCount[c.category] || 0) : null;

    // --- 15. investorOverlapScore ---
    // For each of this company's investors, how many OTHER companies in tracker share that investor?
    // Higher = more connected to other AI companies via investor network
    if (invList.length > 0) {
      let overlap = 0;
      invList.forEach(inv => {
        const key = inv.toLowerCase();
        const portfolio = investorPortfolio[key] || [];
        // Count portfolio companies minus this company itself
        overlap += Math.max(0, portfolio.length - 1);
      });
      c.investorOverlapScore = overlap;
    } else {
      c.investorOverlapScore = 0;
    }

    // --- 16. topAcquirerMentionScore ---
    // Sum of "mention counts" for this company's predicted acquirers
    // High = predicted acquirers are highly active buyers across the space
    if (acqList.length > 0) {
      let score = 0;
      acqList.forEach(acq => {
        const key = acq.toLowerCase();
        score += acquirerMentions[key] || 0;
      });
      c.topAcquirerMentionScore = score;
    } else {
      c.topAcquirerMentionScore = 0;
    }

    // --- 17. mentionedAsAcquirerCount ---
    // How many OTHER companies list THIS company as a potential acquirer
    // Non-zero = this company is a potential buyer in the space
    c.mentionedAsAcquirerCount = mentionedAsAcquirer[c.name.toLowerCase()] || 0;

    // --- 18. sharedInvestorsWithAcquired ---
    // How many investors does this company share with companies that were already acquired?
    // Signal: if your investors' other portfolio companies got acquired, you might be next
    const acquiredCompanies = companies.filter(x => x.status === 'acquired' && x.name !== c.name);
    const myInvestors = new Set(invList.map(i => i.toLowerCase()));
    let sharedCount = 0;
    if (myInvestors.size > 0) {
      acquiredCompanies.forEach(ac => {
        const acInv = splitField(ac.investors).map(i => i.toLowerCase());
        const hasShared = acInv.some(i => myInvestors.has(i));
        if (hasShared) sharedCount++;
      });
    }
    c.sharedInvestorsWithAcquired = sharedCount;

    if (c.competitorsInTracker || c.investorOverlapScore || c.topAcquirerMentionScore) networkCount++;
  });

  // ===== PASS 3: M&A Risk Score (0-100) =====
  // Based on statistical comparison of acquired (42) vs non-acquired (609) companies
  // Higher score = more likely to be an acquisition target
  //
  // Key differentiators from data:
  // - Younger companies (median 5.5yr vs 9yr)
  // - More recent funding (21.8mo vs 39.4mo since last round)
  // - Much higher funding/employee ($13.1M vs $4.0M)
  // - Higher employee growth (55% growing+ vs 63%)
  // - Less likely to have top-tier VC (29% vs 63%)

  // Build percentile arrays for normalization
  function percentileRank(value, sortedArray) {
    if (!sortedArray.length || value === null || value === undefined) return null;
    let count = 0;
    for (const v of sortedArray) { if (v <= value) count++; else break; }
    return Math.round(count / sortedArray.length * 100);
  }

  const allMonthsSince = companies.filter(c => c.lastRoundParsed?.monthsSinceRound != null)
    .map(c => c.lastRoundParsed.monthsSinceRound).sort((a, b) => a - b);
  const allFundingPerEmp = companies.filter(c => c.fundingPerEmployee != null)
    .map(c => c.fundingPerEmployee).sort((a, b) => a - b);
  const allAge = companies.filter(c => c.companyAge != null)
    .map(c => c.companyAge).sort((a, b) => a - b);
  const allRevMultiple = companies.filter(c => c.revenueMultiple != null)
    .map(c => c.revenueMultiple).sort((a, b) => a - b);
  const allInvOverlap = companies.filter(c => c.investorOverlapScore != null)
    .map(c => c.investorOverlapScore).sort((a, b) => a - b);

  let maScoreCount = 0;

  companies.forEach(c => {
    let score = 0;
    let maxScore = 0;

    // --- Recent funding (20 pts) — more recent = higher risk ---
    const msr = c.lastRoundParsed?.monthsSinceRound;
    if (msr != null) {
      const pct = percentileRank(msr, allMonthsSince);
      score += Math.round((100 - pct) * 0.20); // invert: low months = high score
      maxScore += 20;
    }

    // --- Funding per employee (15 pts) — higher = higher risk ---
    if (c.fundingPerEmployee != null) {
      const pct = percentileRank(c.fundingPerEmployee, allFundingPerEmp);
      score += Math.round(pct * 0.15);
      maxScore += 15;
    }

    // --- Company age (10 pts) — younger = higher risk ---
    if (c.companyAge != null) {
      const pct = percentileRank(c.companyAge, allAge);
      score += Math.round((100 - pct) * 0.10); // invert: young = high score
      maxScore += 10;
    }

    // --- Employee growth (15 pts) ---
    if (c.employeeGrowth) {
      const growthScores = { 'high-growth': 15, 'growing': 10, 'steady': 3, 'declining': 1 };
      score += growthScores[c.employeeGrowth] || 0;
      maxScore += 15;
    }

    // --- Top-tier VC (10 pts) — no top-tier = higher risk ---
    score += c.hasTopTierVC ? 0 : 10;
    maxScore += 10;

    // --- Revenue multiple (10 pts) — higher = higher risk ---
    if (c.revenueMultiple != null) {
      const pct = percentileRank(c.revenueMultiple, allRevMultiple);
      score += Math.round(pct * 0.10);
      maxScore += 10;
    }

    // --- Acquirer predicted count (5 pts) — more acquirers named = higher risk ---
    if (c.acquirerPredictedCount > 0) {
      score += Math.min(5, c.acquirerPredictedCount); // cap at 5
      maxScore += 5;
    }

    // --- Shared investors with acquired (5 pts) ---
    if (c.sharedInvestorsWithAcquired > 0) {
      score += Math.min(5, c.sharedInvestorsWithAcquired);
      maxScore += 5;
    }

    // --- Investor overlap/connectedness (5 pts) — more connected = higher risk ---
    if (c.investorOverlapScore != null && c.investorOverlapScore > 0) {
      const pct = percentileRank(c.investorOverlapScore, allInvOverlap);
      score += Math.round(pct * 0.05);
      maxScore += 5;
    }

    // --- Category density (5 pts) — denser = more consolidation pressure ---
    if (c.categoryDensity != null) {
      // Scale: 141 (enterprise) is max
      score += Math.round(Math.min(c.categoryDensity / 141, 1) * 5);
      maxScore += 5;
    }

    // Normalize to 0-100 based on available signals
    if (maxScore > 0) {
      c.maRiskScore = Math.round(score / maxScore * 100);
      maScoreCount++;
    } else {
      c.maRiskScore = null;
    }
  });

  // ===== RESULTS =====
  console.log('\n=== PASS 1: PARSING RESULTS ===');
  console.log(`Revenue:    ${revParsed} parsed, ${revSkipped} non-numeric, ${companies.length - revParsed - revSkipped} empty`);
  console.log(`Valuation:  ${valParsed} parsed, ${companies.length - valParsed} empty/unparseable`);
  console.log(`LastRound:  ${roundParsed} with months_since_round`);
  console.log(`Derived:    ${derivedCount} companies with at least 1 derived field`);

  console.log('\n=== PASS 3: M&A RISK SCORING ===');
  console.log(`M&A Risk Score: ${maScoreCount} companies scored`);
  const scoredAcq = companies.filter(c => c.status === 'acquired' && c.maRiskScore != null);
  const scoredNon = companies.filter(c => c.status !== 'acquired' && c.maRiskScore != null);
  const avgAcq = scoredAcq.length ? Math.round(scoredAcq.reduce((s,c) => s + c.maRiskScore, 0) / scoredAcq.length) : 0;
  const avgNon = scoredNon.length ? Math.round(scoredNon.reduce((s,c) => s + c.maRiskScore, 0) / scoredNon.length) : 0;
  console.log(`Avg score — Acquired: ${avgAcq}, Non-acquired: ${avgNon} (higher is better separation)`);

  console.log('\n=== PASS 2: NETWORK & DENSITY RESULTS ===');
  console.log(`Network:    ${networkCount} companies with at least 1 network signal`);
  const withTopVC = companies.filter(c => c.hasTopTierVC).length;
  console.log(`Top-tier VC: ${withTopVC} companies backed by top-tier VCs`);
  const withTrackerComps = companies.filter(c => c.competitorsInTracker > 0).length;
  console.log(`Competitor cross-refs: ${withTrackerComps} companies have competitors in tracker`);
  const asBuyers = companies.filter(c => c.mentionedAsAcquirerCount > 0).length;
  console.log(`Potential buyers: ${asBuyers} companies mentioned as acquirer by others`);

  // Show some examples
  console.log('\n=== SAMPLE REVENUE PARSES ===');
  companies.filter(c => c.revenue).slice(0, 10).forEach(c => {
    console.log(`  ${c.name}: "${c.revenue}" → ${c.revenueValue !== null ? '$' + c.revenueValue + 'M' : 'null'}`);
  });

  console.log('\n=== SAMPLE VALUATION PARSES ===');
  companies.filter(c => c.valuation).slice(0, 10).forEach(c => {
    console.log(`  ${c.name}: "${c.valuation}" → ${c.valuationValue !== null ? '$' + c.valuationValue + 'M' : 'null'}`);
  });

  console.log('\n=== SAMPLE REVENUE MULTIPLES ===');
  companies.filter(c => c.revenueMultiple).sort((a, b) => b.revenueMultiple - a.revenueMultiple).slice(0, 10).forEach(c => {
    console.log(`  ${c.name}: ${c.revenueMultiple}x ($${c.valuationValue}M val / $${c.revenueValue}M rev)`);
  });

  console.log('\n=== SAMPLE TIME SINCE LAST ROUND ===');
  companies.filter(c => c.lastRoundParsed).sort((a, b) => b.lastRoundParsed.monthsSinceRound - a.lastRoundParsed.monthsSinceRound).slice(0, 10).forEach(c => {
    console.log(`  ${c.name}: ${c.lastRoundParsed.monthsSinceRound} months (${c.lastRound})`);
  });

  console.log('\n=== SAMPLE BURN RATE PROXY ===');
  companies.filter(c => c.burnRateProxy).sort((a, b) => a.burnRateProxy - b.burnRateProxy).slice(0, 10).forEach(c => {
    const fmtFunding = c.fundingValue ? '$' + Math.round(c.fundingValue / 1000000) + 'M' : '?';
    console.log(`  ${c.name}: $${c.burnRateProxy}K/emp/month (funding: ${fmtFunding}, ${c.employeeCount} emp, ${c.lastRoundParsed?.monthsSinceRound}mo)`);
  });

  console.log('\n=== TOP INVESTOR NETWORK SCORES ===');
  companies.filter(c => c.investorOverlapScore > 0).sort((a, b) => b.investorOverlapScore - a.investorOverlapScore).slice(0, 10).forEach(c => {
    console.log(`  ${c.name}: overlap=${c.investorOverlapScore} (${c.investorCount} investors, top-tier: ${c.topTierVCCount})`);
  });

  console.log('\n=== MOST CONNECTED COMPETITORS ===');
  companies.filter(c => c.competitorsInTracker > 0).sort((a, b) => b.competitorsInTracker - a.competitorsInTracker).slice(0, 10).forEach(c => {
    console.log(`  ${c.name}: ${c.competitorsInTracker}/${c.competitorCount} competitors in tracker (category: ${c.category}, density: ${c.categoryDensity})`);
  });

  console.log('\n=== TOP POTENTIAL ACQUIRERS (mentioned by most companies) ===');
  companies.filter(c => c.mentionedAsAcquirerCount > 0).sort((a, b) => b.mentionedAsAcquirerCount - a.mentionedAsAcquirerCount).slice(0, 10).forEach(c => {
    console.log(`  ${c.name}: mentioned as acquirer by ${c.mentionedAsAcquirerCount} companies`);
  });

  console.log('\n=== HIGHEST ACQUIRER MENTION SCORES (targets of active acquirers) ===');
  companies.filter(c => c.topAcquirerMentionScore > 0).sort((a, b) => b.topAcquirerMentionScore - a.topAcquirerMentionScore).slice(0, 10).forEach(c => {
    console.log(`  ${c.name}: score=${c.topAcquirerMentionScore} (acquirers: ${c.acquirers?.slice(0, 60)})`);
  });

  console.log('\n=== SHARED INVESTORS WITH ACQUIRED COMPANIES ===');
  companies.filter(c => c.sharedInvestorsWithAcquired > 0 && c.status !== 'acquired').sort((a, b) => b.sharedInvestorsWithAcquired - a.sharedInvestorsWithAcquired).slice(0, 10).forEach(c => {
    console.log(`  ${c.name}: shares investors with ${c.sharedInvestorsWithAcquired} acquired companies`);
  });

  console.log('\n=== TOP M&A RISK SCORES (non-acquired) ===');
  companies.filter(c => c.maRiskScore != null && c.status !== 'acquired')
    .sort((a, b) => b.maRiskScore - a.maRiskScore).slice(0, 15).forEach(c => {
    console.log(`  ${c.name}: ${c.maRiskScore}/100 (age:${c.companyAge||'?'} growth:${c.employeeGrowth||'?'} topVC:${c.hasTopTierVC} fpe:$${c.fundingPerEmployee||'?'}K)`);
  });

  console.log('\n=== M&A RISK SCORES FOR ACQUIRED COMPANIES (validation) ===');
  scoredAcq.sort((a, b) => b.maRiskScore - a.maRiskScore).forEach(c => {
    console.log(`  ${c.name}: ${c.maRiskScore}/100 (age:${c.companyAge||'?'} growth:${c.employeeGrowth||'?'} topVC:${c.hasTopTierVC} fpe:$${c.fundingPerEmployee||'?'}K)`);
  });

  saveCompanies(companies);
}

main();
