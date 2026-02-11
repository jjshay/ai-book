const Anthropic = require('@anthropic-ai/sdk');
const { fetchCompaniesJson, updateCompaniesJson } = require('./github');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Categories recognized by the tracker
const VALID_CATEGORIES = [
  'foundation-models', 'enterprise-ai', 'developer-tools', 'consumer-ai',
  'healthtech', 'fintech-legal', 'security-ai', 'industrial-ai', 'gtm-ai',
  'data-infra', 'hr-talent', 'supply-chain', 'legal-compliance', 'voice-ai',
  'video-ai', 'creative-ai', 'coding-ai', 'ai-infrastructure', 'robotics-ai',
  'education-ai', 'climate-agri', 'agriculture-ai', 'space-ai', 'ocean-ai',
  'real-estate', 'gaming-ai', 'ai-agents', 'ai-chips', 'photo-ai', 'music-ai',
  'energy-ai', 'healthtech-ai', 'text-ai', 'data-infrastructure', 'travel-ai',
  'insurance-ai', 'legal-ai'
];

async function searchForNews() {
  const today = new Date().toISOString().split('T')[0];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `You are an AI company intelligence analyst. Today is ${today}.

Search your knowledge for the MOST RECENT AI company news from the past 7 days. Focus on:

1. **New Funding Rounds** - Any AI company that announced a new funding round (Series A, B, C, D+, or mega-rounds). Include: company name, amount raised, valuation, lead investors, round type.

2. **Acquisitions** - Any AI company that was acquired or announced acquisition. Include: company name, acquirer, deal value, status.

3. **IPO Announcements** - Any AI company that filed for IPO or went public. Include: company name, exchange, ticker, IPO price.

4. **Major Milestones** - Revenue milestones, product launches, or partnerships that significantly change a company's profile.

Return your findings as a JSON array of objects with this structure:
{
  "events": [
    {
      "type": "funding" | "acquisition" | "ipo" | "milestone",
      "company": "Company Name",
      "details": {
        "amount": "$XXM",
        "valuation": "$XXB",
        "round": "Series X",
        "investors": "Lead Investor, Others",
        "acquirer": "Acquirer Name (if acquisition)",
        "description": "Brief description of the event"
      },
      "confidence": "high" | "medium" | "low",
      "date": "YYYY-MM-DD (approximate)"
    }
  ]
}

Only include events you are reasonably confident about. Return ONLY valid JSON, no markdown.`
    }]
  });

  try {
    const text = response.content[0].text.trim();
    // Try to parse - handle cases where model wraps in markdown
    const jsonStr = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('[Updater] Failed to parse AI response:', e.message);
    return { events: [] };
  }
}

function applyEvent(companies, event) {
  const nameKey = event.company.toLowerCase();
  const existing = companies.find(c => c.name.toLowerCase() === nameKey);

  if (event.type === 'funding' && existing) {
    const updates = {};
    if (event.details.amount) {
      updates.funding = event.details.amount;
      // Parse funding value
      const match = event.details.amount.match(/([\d.]+)\s*(M|B|T)/i);
      if (match) {
        const num = parseFloat(match[1]);
        const mult = match[2].toUpperCase() === 'B' ? 1e9 : match[2].toUpperCase() === 'T' ? 1e12 : 1e6;
        updates.fundingValue = num * mult;
      }
    }
    if (event.details.valuation) updates.valuation = event.details.valuation;
    if (event.details.round) updates.lastRound = `${event.details.round} (${event.date || new Date().getFullYear()})`;
    if (event.details.investors) updates.investors = event.details.investors;
    if (event.details.description) {
      updates.description = event.details.description;
    }

    Object.assign(existing, updates);
    existing.lastAutoUpdate = new Date().toISOString().split('T')[0];

    // Append to fundingRounds history
    if (event.details.round && event.details.amount) {
      if (!existing.fundingRounds) existing.fundingRounds = [];
      existing.fundingRounds.push({
        stage: event.details.round,
        amount: event.details.amount,
        date: event.date || new Date().toISOString().slice(0, 7),
        investors: event.details.investors || ''
      });
    }

    return { action: 'updated', company: event.company };
  }

  if (event.type === 'acquisition' && existing) {
    existing.status = 'acquired';
    existing.acquiredBy = event.details.acquirer || 'Unknown';
    existing.funding = `Acquired by ${event.details.acquirer} (${event.details.amount || 'undisclosed'})`;
    existing.valuation = event.details.amount ? `${event.details.amount} (acquisition)` : 'Acquired';
    existing.lastRound = `Acquired by ${event.details.acquirer} (${event.date || new Date().getFullYear()})`;
    existing.maInsight = `ACQUIRED by ${event.details.acquirer}. ${event.details.description || ''}`;
    existing.lastAutoUpdate = new Date().toISOString().split('T')[0];
    return { action: 'updated_acquisition', company: event.company };
  }

  if (event.type === 'ipo' && existing) {
    existing.funding = `IPO'd (${event.date || new Date().getFullYear()})`;
    existing.valuation = `Public${event.details.amount ? ` - ${event.details.amount}` : ''}`;
    existing.lastRound = `IPO (${event.date || new Date().getFullYear()})`;
    existing.maInsight = `NOW PUBLIC. ${event.details.description || ''}`;
    existing.lastAutoUpdate = new Date().toISOString().split('T')[0];
    return { action: 'updated_ipo', company: event.company };
  }

  if (event.type === 'funding' && !existing && event.confidence === 'high') {
    // Add new company
    const maxId = Math.max(...companies.map(c => c.id));
    const newCompany = {
      id: maxId + 1,
      name: event.company,
      product: event.details.description ? event.details.description.split('.')[0] : 'AI Platform',
      category: 'enterprise-ai',
      founded: new Date().getFullYear(),
      funding: event.details.amount || 'Unknown',
      fundingValue: 0,
      rating: 3,
      website: '',
      hq: '',
      description: event.details.description || `AI company with ${event.details.amount} in funding.`,
      lastAutoUpdate: new Date().toISOString().split('T')[0],
      dateAdded: new Date().toISOString().split('T')[0]
    };

    if (event.details.amount) {
      const match = event.details.amount.match(/([\d.]+)\s*(M|B|T)/i);
      if (match) {
        const num = parseFloat(match[1]);
        const mult = match[2].toUpperCase() === 'B' ? 1e9 : match[2].toUpperCase() === 'T' ? 1e12 : 1e6;
        newCompany.fundingValue = num * mult;
      }
    }
    if (event.details.valuation) newCompany.valuation = event.details.valuation;
    if (event.details.round) newCompany.lastRound = `${event.details.round} (${event.date || new Date().getFullYear()})`;
    if (event.details.investors) newCompany.investors = event.details.investors;

    companies.push(newCompany);
    return { action: 'added', company: event.company };
  }

  return null;
}

async function runDailyUpdate() {
  console.log('[Updater] Starting daily update...');

  // 1. Fetch current companies.json from GitHub
  const companies = await fetchCompaniesJson();
  console.log(`[Updater] Loaded ${companies.length} companies from GitHub`);

  // 2. Search for recent AI news using Claude
  const news = await searchForNews();
  console.log(`[Updater] Found ${news.events.length} events`);

  if (news.events.length === 0) {
    return {
      summary: 'No new events found',
      companiesUpdated: 0,
      companiesAdded: 0,
      events: []
    };
  }

  // 3. Apply events to companies
  const changes = [];
  for (const event of news.events) {
    if (event.confidence === 'low') continue; // Skip low-confidence events
    const result = applyEvent(companies, event);
    if (result) changes.push(result);
  }

  if (changes.length === 0) {
    return {
      summary: 'Events found but no changes applied',
      companiesUpdated: 0,
      companiesAdded: 0,
      events: news.events.map(e => e.company)
    };
  }

  // 4. Sort and re-index
  companies.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  companies.forEach((c, i) => { c.id = i + 1; });

  // 5. Push updated companies.json to GitHub
  await updateCompaniesJson(companies, changes);

  const updated = changes.filter(c => c.action.startsWith('updated')).length;
  const added = changes.filter(c => c.action === 'added').length;

  return {
    summary: `Updated ${updated} companies, added ${added} new companies`,
    companiesUpdated: updated,
    companiesAdded: added,
    changes: changes,
    totalCompanies: companies.length
  };
}

module.exports = { runDailyUpdate };
