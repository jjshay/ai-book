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

// ========== MAIN ==========
function main() {
  const companies = loadCompanies();
  console.log(`Loaded ${companies.length} companies`);

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
    // funding / (employees * months since last round)
    // Rough proxy — higher = more runway per head per month
    // fundingValue is in raw dollars (e.g. 79000000 for $79M)
    const fundingRaw = c.fundingValue || null;
    const empCount = c.employeeCount || null;
    const monthsSince = c.lastRoundParsed?.monthsSinceRound;

    if (fundingRaw && empCount && monthsSince && monthsSince > 0) {
      // funding per employee per month in thousands of dollars
      c.burnRateProxy = Math.round(fundingRaw / empCount / monthsSince / 1000);
    } else {
      c.burnRateProxy = null;
    }

    // --- 6. Derived: company_age ---
    if (c.founded) {
      c.companyAge = new Date().getFullYear() - c.founded;
    }

    // --- 7. Derived: funding_per_employee ---
    // In thousands of dollars
    if (fundingRaw && empCount) {
      c.fundingPerEmployee = Math.round(fundingRaw / empCount / 1000);
    } else {
      c.fundingPerEmployee = null;
    }

    if (c.revenueMultiple || c.burnRateProxy || c.fundingPerEmployee) derivedCount++;
  });

  console.log('\n=== RESULTS ===');
  console.log(`Revenue:    ${revParsed} parsed, ${revSkipped} non-numeric, ${companies.length - revParsed - revSkipped} empty`);
  console.log(`Valuation:  ${valParsed} parsed, ${companies.length - valParsed} empty/unparseable`);
  console.log(`LastRound:  ${roundParsed} with months_since_round`);
  console.log(`Derived:    ${derivedCount} companies with at least 1 derived field`);

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

  saveCompanies(companies);
}

main();
