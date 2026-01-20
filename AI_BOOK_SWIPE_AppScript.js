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
  // Clean modern email template
  var h = "<!DOCTYPE html><html><head><meta charset='utf-8'></head>";
  h += "<body style='margin:0;padding:0;background:#0a0f1a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif'>";
  h += "<table width='100%' cellpadding='0' cellspacing='0' style='background:#0a0f1a'><tr><td style='padding:40px 20px'>";
  h += "<table width='100%' cellpadding='0' cellspacing='0' style='max-width:600px;margin:0 auto'>";

  // Header
  h += "<tr><td style='padding:0 0 30px 0;text-align:center'>";
  h += "<div style='font-size:32px;font-weight:800;color:#ffffff;letter-spacing:2px'>AI BOOK</div>";
  h += "<div style='font-size:14px;color:#64748b;margin-top:4px'>Your Watchlist</div>";
  h += "</td></tr>";

  // Stats bar
  h += "<tr><td style='padding:20px;background:linear-gradient(135deg,#1e3a5f,#0d1f33);border-radius:12px;margin-bottom:20px'>";
  h += "<table width='100%' cellpadding='0' cellspacing='0'><tr>";
  h += "<td style='text-align:center;padding:10px'>";
  h += "<div style='font-size:36px;font-weight:800;color:#D4AF37'>" + companies.length + "</div>";
  h += "<div style='font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px'>Companies Saved</div>";
  h += "</td></tr></table>";
  h += "</td></tr>";

  h += "<tr><td style='height:20px'></td></tr>";

  // Company cards
  for (var i = 0; i < companies.length; i++) {
    var c = companies[i];
    var initial = c.name.charAt(0).toUpperCase();

    h += "<tr><td style='padding:16px 20px;background:#111827;border-radius:12px;margin-bottom:12px;border:1px solid #1f2937'>";
    h += "<table width='100%' cellpadding='0' cellspacing='0'>";

    // Company header row
    h += "<tr><td colspan='2' style='padding-bottom:12px;border-bottom:1px solid #1f2937'>";
    h += "<table cellpadding='0' cellspacing='0'><tr>";
    h += "<td style='width:44px;vertical-align:middle'>";
    h += "<div style='width:40px;height:40px;background:#1e3a5f;border-radius:10px;text-align:center;line-height:40px;font-size:18px;font-weight:700;color:#D4AF37'>" + initial + "</div>";
    h += "</td>";
    h += "<td style='padding-left:12px;vertical-align:middle'>";
    h += "<div style='font-size:18px;font-weight:700;color:#ffffff'>" + c.name + "</div>";
    h += "<div style='font-size:13px;color:#00CED1;margin-top:2px'>" + (c.product || '') + "</div>";
    h += "</td>";
    h += "<td style='text-align:right;vertical-align:middle'>";
    h += "<div style='font-size:16px;font-weight:700;color:#22c55e'>" + (c.funding || 'N/A') + "</div>";
    h += "</td>";
    h += "</tr></table>";
    h += "</td></tr>";

    // Secret Sauce
    if (c.secretSauce) {
      h += "<tr><td colspan='2' style='padding:12px 0'>";
      h += "<div style='background:#1a1a2e;border-left:3px solid #f59e0b;padding:10px 12px;border-radius:0 8px 8px 0'>";
      h += "<span style='font-size:12px;color:#fbbf24'>&#128293; " + c.secretSauce + "</span>";
      h += "</div>";
      h += "</td></tr>";
    }

    // Description
    if (c.description) {
      h += "<tr><td colspan='2' style='padding:10px 0 0 0'>";
      h += "<p style='font-size:13px;color:#9ca3af;line-height:1.5;margin:0'>" + c.description + "</p>";
      h += "</td></tr>";
    }

    // Meta info
    h += "<tr><td colspan='2' style='padding-top:12px'>";
    h += "<table cellpadding='0' cellspacing='0'><tr>";
    if (c.hq) {
      h += "<td style='padding-right:16px'><span style='font-size:11px;color:#64748b'>" + c.hq + "</span></td>";
    }
    if (c.employees) {
      h += "<td style='padding-right:16px'><span style='font-size:11px;color:#64748b'>" + c.employees + "</span></td>";
    }
    if (c.ceo) {
      h += "<td><span style='font-size:11px;color:#64748b'>CEO: " + c.ceo + "</span></td>";
    }
    h += "</tr></table>";
    h += "</td></tr>";

    // Website button
    if (c.website) {
      h += "<tr><td colspan='2' style='padding-top:14px'>";
      h += "<a href='https://" + c.website + "' style='display:inline-block;background:#D4AF37;color:#0a0f1a;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px'>Visit " + c.website + "</a>";
      h += "</td></tr>";
    }

    h += "</table>";
    h += "</td></tr>";
    h += "<tr><td style='height:12px'></td></tr>";
  }

  // Footer
  h += "<tr><td style='padding:30px 0;text-align:center'>";
  h += "<p style='font-size:11px;color:#4b5563;margin:0'>Powered by <a href='https://jjshay.com' style='color:#D4AF37;text-decoration:none'>jjshay.com</a></p>";
  h += "</td></tr>";

  h += "</table></td></tr></table></body></html>";

  GmailApp.sendEmail(email, "AI BOOK - Your Watchlist (" + companies.length + " companies)", "View this email in HTML format", {htmlBody: h});
}

function testEmail() {
  var c = [
    {name: "OpenAI", product: "ChatGPT / GPT-4", funding: "$11B+", website: "openai.com", hq: "San Francisco, CA", employees: "2,000+", ceo: "Sam Altman", secretSauce: "Category creator + consumer habit + enterprise API dominance", description: "The company that started the generative AI revolution with ChatGPT."},
    {name: "Anthropic", product: "Claude", funding: "$7.3B+", website: "anthropic.com", hq: "San Francisco, CA", employees: "800+", ceo: "Dario Amodei", secretSauce: "Constitutional AI + safety-first positioning", description: "Safety-focused AI lab building Claude."}
  ];
  sendWatchlistEmail("jjshay@gmail.com", c);
}
