function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);

  // Deduplicate companies by name
  var seen = {};
  var uniqueCompanies = [];
  for (var i = 0; i < data.companies.length; i++) {
    var name = data.companies[i].name;
    if (!seen[name]) {
      seen[name] = true;
      uniqueCompanies.push(data.companies[i]);
    }
  }

  sheet.appendRow([new Date(), data.email, uniqueCompanies.length, JSON.stringify(uniqueCompanies.map(c => c.name))]);
  sendWatchlistEmail(data.email, uniqueCompanies);
  return ContentService.createTextOutput("OK");
}

function sendWatchlistEmail(email, companies) {
  // Color palette matching AI Book app
  var bg = '#0a1628';
  var cardBg = '#0f1d32';
  var navy = '#1e3a5f';
  var gold = '#D4AF37';
  var goldLight = '#F4CF47';
  var cyan = '#00CED1';
  var textWhite = '#ffffff';
  var textDim = '#94a3b8';
  var textMuted = '#64748b';
  var border = 'rgba(212,175,55,0.2)';
  var borderSolid = '#2a3a52';

  // Compute aggregate stats
  var totalFunding = 0;
  var categories = {};
  for (var i = 0; i < companies.length; i++) {
    var c = companies[i];
    if (c.fundingValue) totalFunding += c.fundingValue;
    var cat = c.category || 'other';
    categories[cat] = (categories[cat] || 0) + 1;
  }
  var fundingLabel = totalFunding >= 1e9
    ? '$' + (totalFunding / 1e9).toFixed(1) + 'B'
    : totalFunding >= 1e6
      ? '$' + (totalFunding / 1e6).toFixed(0) + 'M'
      : 'N/A';
  var catCount = Object.keys(categories).length;

  // Category display names
  var catLabels = {
    'foundation-models': 'Foundation Models', 'enterprise-ai': 'Enterprise AI',
    'developer-tools': 'Dev Tools', 'consumer-ai': 'Consumer AI',
    'video-ai': 'Video AI', 'voice-ai': 'Voice AI',
    'healthtech': 'Healthcare', 'healthtech-ai': 'Healthcare',
    'fintech-legal': 'Fintech', 'fintech-ai': 'Fintech',
    'security-ai': 'Security', 'robotics-ai': 'Robotics',
    'gtm-ai': 'GTM/Sales', 'industrial-ai': 'Industrial',
    'data-infra': 'Data Infra', 'data-infrastructure': 'Data Infra',
    'education-ai': 'Education', 'hr-talent': 'HR/Talent',
    'supply-chain': 'Supply Chain', 'legal-compliance': 'Legal',
    'legal-ai': 'Legal', 'real-estate': 'Real Estate',
    'climate-agri': 'Climate', 'agriculture-ai': 'Agriculture',
    'photo-ai': 'Photo AI', 'text-ai': 'Text AI',
    'space-ai': 'Space', 'ocean-ai': 'Ocean',
    'gaming-ai': 'Gaming', 'music-ai': 'Music',
    'travel-ai': 'Travel', 'energy-ai': 'Energy',
    'insurance-ai': 'Insurance', 'ai-agents': 'AI Agents',
    'coding-ai': 'Coding', 'ai-infrastructure': 'AI Infra',
    'ai-chips': 'AI Chips', 'creative-ai': 'Creative',
    'search-ai': 'Search'
  };

  function getCatLabel(cat) {
    return catLabels[cat] || cat || '';
  }

  function getRatingStars(rating) {
    var r = rating || 3;
    var s = '';
    for (var x = 0; x < 5; x++) {
      s += x < r ? '&#9733;' : '&#9734;';
    }
    return s;
  }

  // Build email HTML
  var h = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1.0'></head>";
  h += "<body style='margin:0;padding:0;background:" + bg + ";font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,sans-serif;-webkit-font-smoothing:antialiased'>";
  h += "<table width='100%' cellpadding='0' cellspacing='0' style='background:" + bg + "'><tr><td style='padding:32px 16px'>";
  h += "<table width='100%' cellpadding='0' cellspacing='0' style='max-width:640px;margin:0 auto'>";

  // ===== HEADER =====
  h += "<tr><td style='padding:32px 24px;background:" + navy + ";border-radius:16px 16px 0 0;border-bottom:2px solid " + gold + ";text-align:center'>";
  h += "<div style='font-size:28px;font-weight:800;color:" + gold + ";letter-spacing:3px;margin-bottom:4px'>AI BOOK</div>";
  h += "<div style='font-size:13px;color:" + textDim + ";letter-spacing:1px;text-transform:uppercase'>Your Watchlist</div>";
  h += "</td></tr>";

  // ===== STATS BAR =====
  h += "<tr><td style='padding:0'>";
  h += "<table width='100%' cellpadding='0' cellspacing='0' style='background:" + cardBg + ";border-bottom:1px solid " + borderSolid + "'><tr>";
  // Companies count
  h += "<td width='33%' style='text-align:center;padding:20px 8px'>";
  h += "<div style='font-size:28px;font-weight:800;color:" + gold + "'>" + companies.length + "</div>";
  h += "<div style='font-size:10px;color:" + textMuted + ";text-transform:uppercase;letter-spacing:1px;margin-top:2px'>Companies</div>";
  h += "</td>";
  // Total funding
  h += "<td width='34%' style='text-align:center;padding:20px 8px;border-left:1px solid " + borderSolid + ";border-right:1px solid " + borderSolid + "'>";
  h += "<div style='font-size:28px;font-weight:800;color:" + textWhite + "'>" + fundingLabel + "</div>";
  h += "<div style='font-size:10px;color:" + textMuted + ";text-transform:uppercase;letter-spacing:1px;margin-top:2px'>Total Funding</div>";
  h += "</td>";
  // Categories
  h += "<td width='33%' style='text-align:center;padding:20px 8px'>";
  h += "<div style='font-size:28px;font-weight:800;color:" + cyan + "'>" + catCount + "</div>";
  h += "<div style='font-size:10px;color:" + textMuted + ";text-transform:uppercase;letter-spacing:1px;margin-top:2px'>Categories</div>";
  h += "</td>";
  h += "</tr></table>";
  h += "</td></tr>";

  // ===== COMPANY CARDS =====
  for (var i = 0; i < companies.length; i++) {
    var c = companies[i];
    var initial = c.name.charAt(0).toUpperCase();
    var catLabel = getCatLabel(c.category);
    var stars = getRatingStars(c.rating);
    var isLast = (i === companies.length - 1);

    h += "<tr><td style='padding:0'>";
    h += "<table width='100%' cellpadding='0' cellspacing='0' style='background:" + cardBg + ";" + (isLast ? "border-radius:0 0 16px 16px;" : "") + "border-bottom:1px solid " + borderSolid + "'>";

    // === Company Header: Logo + Name + Funding ===
    h += "<tr><td style='padding:20px 24px 0 24px'>";
    h += "<table width='100%' cellpadding='0' cellspacing='0'><tr>";
    // Initial badge
    h += "<td style='width:48px;vertical-align:top'>";
    h += "<div style='width:44px;height:44px;background:" + navy + ";border:2px solid " + gold + ";border-radius:12px;text-align:center;line-height:44px;font-size:20px;font-weight:800;color:" + gold + "'>" + initial + "</div>";
    h += "</td>";
    // Name + product
    h += "<td style='padding-left:14px;vertical-align:top'>";
    h += "<div style='font-size:18px;font-weight:700;color:" + textWhite + ";line-height:1.2'>" + c.name + "</div>";
    if (c.product) {
      h += "<div style='font-size:12px;color:" + cyan + ";margin-top:2px;font-weight:600'>" + c.product + "</div>";
    }
    h += "</td>";
    // Funding badge
    h += "<td style='text-align:right;vertical-align:top'>";
    h += "<div style='display:inline-block;background:" + navy + ";border:1px solid " + gold + ";border-radius:8px;padding:6px 12px'>";
    h += "<div style='font-size:16px;font-weight:800;color:" + gold + ";line-height:1.2'>" + (c.funding || 'N/A') + "</div>";
    h += "<div style='font-size:9px;color:" + textMuted + ";text-transform:uppercase;letter-spacing:0.5px'>Funding</div>";
    h += "</div>";
    h += "</td>";
    h += "</tr></table>";
    h += "</td></tr>";

    // === Rating + Category row ===
    h += "<tr><td style='padding:10px 24px 0 24px'>";
    h += "<table cellpadding='0' cellspacing='0'><tr>";
    h += "<td style='padding-right:16px'><span style='font-size:14px;color:" + gold + ";letter-spacing:1px'>" + stars + "</span></td>";
    if (catLabel) {
      h += "<td><span style='display:inline-block;background:" + navy + ";color:" + goldLight + ";font-size:10px;font-weight:700;padding:3px 10px;border-radius:10px;text-transform:uppercase;letter-spacing:0.5px'>" + catLabel + "</span></td>";
    }
    h += "</tr></table>";
    h += "</td></tr>";

    // === Key Metrics Grid ===
    var hasValuation = c.valuation && c.valuation !== 'N/A';
    var hasLastRound = c.lastRound;
    var hasInvestors = c.investors;

    if (hasValuation || hasLastRound || c.hq || c.employees) {
      h += "<tr><td style='padding:12px 24px 0 24px'>";
      h += "<table width='100%' cellpadding='0' cellspacing='0' style='background:" + bg + ";border-radius:10px;overflow:hidden'><tr>";

      if (hasValuation) {
        h += "<td width='50%' style='padding:10px 14px;border-right:1px solid " + borderSolid + ";border-bottom:1px solid " + borderSolid + "'>";
        h += "<div style='font-size:9px;color:" + textMuted + ";text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px'>Valuation</div>";
        h += "<div style='font-size:14px;font-weight:700;color:" + goldLight + "'>" + c.valuation + "</div>";
        h += "</td>";
      }

      if (hasLastRound) {
        h += "<td width='50%' style='padding:10px 14px;border-bottom:1px solid " + borderSolid + "'>";
        h += "<div style='font-size:9px;color:" + textMuted + ";text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px'>Last Round</div>";
        h += "<div style='font-size:13px;font-weight:600;color:" + textWhite + "'>" + c.lastRound + "</div>";
        h += "</td>";
      } else if (hasValuation) {
        h += "<td width='50%' style='padding:10px 14px;border-bottom:1px solid " + borderSolid + "'></td>";
      }

      h += "</tr><tr>";

      if (c.hq) {
        h += "<td width='50%' style='padding:10px 14px;border-right:1px solid " + borderSolid + "'>";
        h += "<div style='font-size:9px;color:" + textMuted + ";text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px'>HQ</div>";
        h += "<div style='font-size:13px;font-weight:600;color:" + textWhite + "'>" + c.hq + "</div>";
        h += "</td>";
      }

      if (c.employees) {
        h += "<td width='50%' style='padding:10px 14px'>";
        h += "<div style='font-size:9px;color:" + textMuted + ";text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px'>Employees</div>";
        h += "<div style='font-size:13px;font-weight:600;color:" + textWhite + "'>" + c.employees + "</div>";
        h += "</td>";
      } else if (c.hq) {
        h += "<td width='50%' style='padding:10px 14px'></td>";
      }

      h += "</tr></table>";
      h += "</td></tr>";
    }

    // === Investors ===
    if (hasInvestors) {
      h += "<tr><td style='padding:12px 24px 0 24px'>";
      h += "<div style='font-size:9px;color:" + textMuted + ";text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px'>Key Investors</div>";
      h += "<div style='font-size:12px;color:" + textDim + ";line-height:1.4'>" + c.investors + "</div>";
      h += "</td></tr>";
    }

    // === Secret Sauce ===
    if (c.secretSauce) {
      h += "<tr><td style='padding:12px 24px 0 24px'>";
      h += "<div style='background:" + bg + ";border-left:3px solid " + gold + ";padding:10px 14px;border-radius:0 8px 8px 0'>";
      h += "<div style='font-size:9px;color:" + gold + ";text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;font-weight:700'>Secret Sauce</div>";
      h += "<div style='font-size:12px;color:" + goldLight + ";line-height:1.4'>" + c.secretSauce + "</div>";
      h += "</div>";
      h += "</td></tr>";
    }

    // === CEO + Website row ===
    h += "<tr><td style='padding:14px 24px 20px 24px'>";
    h += "<table width='100%' cellpadding='0' cellspacing='0'><tr>";
    if (c.ceo) {
      h += "<td style='vertical-align:middle'>";
      h += "<span style='font-size:11px;color:" + textMuted + "'>CEO: </span>";
      h += "<span style='font-size:11px;color:" + textDim + ";font-weight:600'>" + c.ceo + "</span>";
      h += "</td>";
    }
    if (c.website) {
      h += "<td style='text-align:right;vertical-align:middle'>";
      h += "<a href='https://" + c.website + "' target='_blank' style='display:inline-block;background:" + gold + ";color:" + bg + ";padding:8px 18px;border-radius:8px;text-decoration:none;font-size:11px;font-weight:700;letter-spacing:0.5px'>" + c.website + " &rarr;</a>";
      h += "</td>";
    }
    h += "</tr></table>";
    h += "</td></tr>";

    h += "</table>";
    h += "</td></tr>";
  }

  // ===== FOOTER =====
  h += "<tr><td style='padding:28px 24px;text-align:center'>";
  h += "<div style='font-size:10px;color:" + textMuted + ";margin-bottom:6px'>Generated " + new Date().toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) + "</div>";
  h += "<div style='font-size:11px;color:" + textMuted + "'>Powered by <a href='https://jjshay.com/AI' style='color:" + gold + ";text-decoration:none;font-weight:600'>jjshay.com/AI</a></div>";
  h += "</td></tr>";

  h += "</table></td></tr></table></body></html>";

  GmailApp.sendEmail(email, "Your Watchlist - " + companies.length + " AI Companies", "View this email in HTML format", {htmlBody: h});
}

function testEmail() {
  var c = [
    {name: "OpenAI", product: "ChatGPT / GPT-4", category: "foundation-models", funding: "$17.9B+", fundingValue: 17900000000, valuation: "$500B", lastRound: "Series G ($6.6B, Oct 2025)", website: "openai.com", hq: "San Francisco, CA", employees: "2,000-3,000", ceo: "Sam Altman", rating: 5, investors: "Thrive Capital, Microsoft, SoftBank, Nvidia", secretSauce: "Category creator + consumer habit + enterprise API dominance"},
    {name: "Anthropic", product: "Claude", category: "foundation-models", funding: "$15B+", fundingValue: 15000000000, valuation: "$350B", lastRound: "Series G ($15B, Nov 2025)", website: "anthropic.com", hq: "San Francisco, CA", employees: "800-1,200", ceo: "Dario Amodei", rating: 5, investors: "ICONIQ, Microsoft, Nvidia, Google, Coatue", secretSauce: "Constitutional AI + safety-first positioning + enterprise trust"},
    {name: "Perplexity", product: "Perplexity", category: "consumer-ai", funding: "$1.5B", fundingValue: 1500000000, valuation: "$20B", lastRound: "Series C ($200M, Sep 2025)", website: "perplexity.ai", hq: "San Francisco, CA", employees: "50-80", ceo: "Aravind Srinivas", rating: 5, investors: "IVP, NEA, Jeff Bezos, Nvidia, SoftBank", secretSauce: "AI answer engine + real-time search + citations"}
  ];
  sendWatchlistEmail("jjshay@gmail.com", c);
}
