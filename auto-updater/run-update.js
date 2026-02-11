// Standalone script to run an update manually
// Usage: ANTHROPIC_API_KEY=xxx GITHUB_TOKEN=xxx node run-update.js

const { runDailyUpdate } = require('./updater');

(async () => {
  console.log('Starting manual update...');
  try {
    const result = await runDailyUpdate();
    console.log('\nUpdate complete:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Update failed:', error.message);
    process.exit(1);
  }
})();
