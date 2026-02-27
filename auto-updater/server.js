const express = require('express');
const cron = require('node-cron');
const { runDailyUpdate } = require('./updater');
const { getUpdateHistory, updateCompaniesJson } = require('./github');
const { enrichGitHubIncremental, loadCompanies, saveCompaniesLocal } = require('./enrich-apis');
const { refreshNewsRSS } = require('./enrich-news');

const app = express();
const PORT = process.env.PORT || 3000;

// Store recent update logs in memory
const updateLogs = [];

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    service: 'AI Book Auto-Updater',
    status: 'running',
    lastCheck: updateLogs.length > 0 ? updateLogs[updateLogs.length - 1].timestamp : 'never',
    totalUpdates: updateLogs.length,
    nextRun: 'Daily at 6:00 AM UTC'
  });
});

// Manual trigger endpoint (protected by secret)
app.post('/trigger', async (req, res) => {
  const secret = req.headers['x-update-secret'] || req.query.secret;
  if (secret !== process.env.UPDATE_SECRET && process.env.UPDATE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.json({ message: 'Update triggered', status: 'processing' });

  try {
    const result = await runDailyUpdate();
    updateLogs.push({ timestamp: new Date().toISOString(), ...result });
    console.log('[Update] Completed:', result.summary);

    // Run signal enrichment after main update
    const signals = await runSignalEnrichment();
    console.log(`[Update] Signals: ${signals.ghCount} GitHub, ${signals.newsCount} news`);
  } catch (error) {
    console.error('[Update] Failed:', error.message);
    updateLogs.push({ timestamp: new Date().toISOString(), error: error.message });
  }
});

// View update history
app.get('/history', (req, res) => {
  res.json({
    updates: updateLogs.slice(-20).reverse(),
    total: updateLogs.length
  });
});

// Dashboard HTML
app.get('/dashboard', (req, res) => {
  const recentUpdates = updateLogs.slice(-10).reverse();
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>AI Book Auto-Updater</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { --bg: #0a1628; --card: #0f1d32; --gold: #D4AF37; --cyan: #00CED1; --text: #fff; --dim: #94a3b8; --green: #22c55e; --red: #ef4444; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { color: var(--gold); font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: var(--dim); font-size: 14px; margin-bottom: 24px; }
    .status-card { background: var(--card); border: 1px solid rgba(212,175,55,0.25); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .status-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; }
    .label { color: var(--dim); font-size: 13px; }
    .value { font-weight: 600; font-size: 14px; }
    .value.running { color: var(--green); }
    .trigger-btn { background: var(--gold); color: var(--bg); border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 14px; margin-top: 12px; }
    .trigger-btn:hover { opacity: 0.9; }
    .update-item { background: var(--card); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 16px; margin-bottom: 8px; }
    .update-time { color: var(--cyan); font-size: 12px; font-weight: 600; }
    .update-summary { font-size: 13px; color: var(--text); margin-top: 4px; }
    .update-changes { font-size: 12px; color: var(--dim); margin-top: 4px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .badge.success { background: rgba(34,197,94,0.2); color: var(--green); }
    .badge.error { background: rgba(239,68,68,0.2); color: var(--red); }
    .badge.pending { background: rgba(212,175,55,0.2); color: var(--gold); }
    .empty { color: var(--dim); font-size: 14px; text-align: center; padding: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>AI Book Auto-Updater</h1>
    <p class="subtitle">Daily AI-powered company intelligence for your tracker</p>

    <div class="status-card">
      <div class="status-row">
        <span class="label">Status</span>
        <span class="value running">Active</span>
      </div>
      <div class="status-row">
        <span class="label">Schedule</span>
        <span class="value">Daily at 6:00 AM UTC</span>
      </div>
      <div class="status-row">
        <span class="label">Total Updates Run</span>
        <span class="value">${updateLogs.length}</span>
      </div>
      <div class="status-row">
        <span class="label">Last Run</span>
        <span class="value">${updateLogs.length > 0 ? new Date(updateLogs[updateLogs.length - 1].timestamp).toLocaleString() : 'Never'}</span>
      </div>
      <button class="trigger-btn" onclick="triggerUpdate()">Run Update Now</button>
    </div>

    <h2 style="color: var(--cyan); font-size: 18px; margin: 24px 0 12px;">Recent Updates</h2>
    ${recentUpdates.length === 0 ? '<div class="empty">No updates yet. Click "Run Update Now" or wait for the daily cron.</div>' :
      recentUpdates.map(u => `
        <div class="update-item">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="update-time">${new Date(u.timestamp).toLocaleString()}</span>
            <span class="badge ${u.error ? 'error' : 'success'}">${u.error ? 'Error' : 'Success'}</span>
          </div>
          ${u.error ? `<div class="update-changes" style="color:var(--red)">${u.error}</div>` : `
            <div class="update-summary">${u.summary || 'Update completed'}</div>
            <div class="update-changes">${u.companiesUpdated || 0} companies updated, ${u.companiesAdded || 0} new companies added</div>
          `}
        </div>
      `).join('')
    }
  </div>
  <script>
    async function triggerUpdate() {
      const btn = document.querySelector('.trigger-btn');
      btn.textContent = 'Running...';
      btn.disabled = true;
      try {
        await fetch('/trigger', { method: 'POST' });
        setTimeout(() => location.reload(), 5000);
      } catch(e) {
        btn.textContent = 'Error - Try Again';
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`);
});

// Run signal enrichment (GitHub + News) after main update
async function runSignalEnrichment() {
  const companies = await loadCompanies();
  let ghCount = 0, newsCount = 0;

  try {
    ghCount = await enrichGitHubIncremental(companies);
  } catch (err) {
    console.error('[Signal] GitHub enrichment error:', err.message);
  }

  try {
    newsCount = await refreshNewsRSS(companies);
  } catch (err) {
    console.error('[Signal] News enrichment error:', err.message);
  }

  if (ghCount + newsCount > 0) {
    saveCompaniesLocal(companies);
    if (process.env.CI || process.env.GITHUB_TOKEN) {
      await updateCompaniesJson(companies, [
        { action: 'signal-enrichment', company: `${ghCount} GitHub + ${newsCount} news updates` },
      ]);
    }
  }

  return { ghCount, newsCount };
}

// Schedule daily update at 6:00 AM UTC
cron.schedule('0 6 * * *', async () => {
  console.log('[Cron] Starting daily update at', new Date().toISOString());
  try {
    const result = await runDailyUpdate();
    updateLogs.push({ timestamp: new Date().toISOString(), ...result });
    console.log('[Cron] Update complete:', result.summary);

    // Run signal enrichment after main update
    console.log('[Cron] Starting signal enrichment...');
    const signals = await runSignalEnrichment();
    console.log(`[Cron] Signals: ${signals.ghCount} GitHub, ${signals.newsCount} news`);
  } catch (error) {
    console.error('[Cron] Update failed:', error.message);
    updateLogs.push({ timestamp: new Date().toISOString(), error: error.message });
  }
}, { timezone: 'UTC' });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Book Auto-Updater running on port ${PORT}`);
  console.log('Dashboard: http://localhost:' + PORT + '/dashboard');
  console.log('Cron: Daily at 6:00 AM UTC');
});
