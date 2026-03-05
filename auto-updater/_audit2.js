const data = JSON.parse(require('fs').readFileSync('companies.json','utf-8'));

// Re-run parse to see current state
console.log('=== STILL UNPARSED lastRound ===');
const unparsed = data.filter(c => c.lastRound && !c.lastRoundParsed);
unparsed.forEach(c => console.log(`  "${c.lastRound}"`));
console.log('Total:', unparsed.length);

console.log('\n=== NO lastRound field at all ===');
const noField = data.filter(c => !c.lastRound);
console.log('Total:', noField.length);
console.log('Sample:', noField.slice(0, 10).map(c => c.name).join(', '));

// Check stageEncoded gaps
console.log('\n=== HAS lastRoundParsed but NO stage ===');
const noStage = data.filter(c => c.lastRoundParsed && !c.lastRoundParsed.stage);
noStage.forEach(c => console.log(`  "${c.lastRound}" -> parsed year: ${c.lastRoundParsed.year}`));
console.log('Total:', noStage.length);

// Run the export to see updated completeness
console.log('\n=== FEATURE COVERAGE SUMMARY ===');
const fields = [
  ['stageEncoded', c => { // re-derive
    if (!c.lastRoundParsed || !c.lastRoundParsed.stage) return false;
    return true;
  }],
  ['monthsSinceRound', c => c.lastRoundParsed && c.lastRoundParsed.monthsSinceRound != null],
  ['burnRateProxy', c => c.burnRateProxy != null],
  ['revenueValue', c => c.revenueValue != null],
  ['valuationValue', c => c.valuationValue != null],
  ['revenueMultiple', c => c.revenueMultiple != null],
  ['trancoRank', c => c.tranco_rank != null && c.tranco_rank > 0],
  ['githubWeeklyCommits', c => c.github_weekly_commits != null && c.github_weekly_commits > 0],
  ['appRating', c => c.app_rating != null],
];

fields.forEach(([name, test]) => {
  const count = data.filter(test).length;
  const pct = Math.round(count / data.length * 100);
  console.log(`  ${name.padEnd(25)} ${count}/${data.length} (${pct}%)`);
});
