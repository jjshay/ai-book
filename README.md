# AI Book - The Pocket Guide to 623 AI Companies

**Live App:** [jjshay.github.io/ai-book](https://jjshay.github.io/ai-book/)

A mobile-first intelligence tracker for the AI industry. Swipe through 623 private AI companies, save your watchlist, and export it — all from your phone.

---

## Why I Built This

The AI industry moves too fast. Every week there's a new unicorn, a new acquisition, a new model launch. The information is scattered across TechCrunch, LinkedIn, Crunchbase, Twitter/X, newsletters, and dozens of niche trackers. None of them give you a single, clean, opinionated view of the landscape.

**The problem is noise.** There are thousands of AI companies. Most people can name 10-15. Investors and analysts need to know hundreds. But there's no simple way to browse, filter, and build a personal shortlist without opening 47 browser tabs.

**AI Book solves this by being deliberately simple:**

- **One place.** 623 companies with real data — funding, investors, HQ, CEO, product, founding year, category, health status, and an editorial rating. No paywalls, no sign-ups.
- **One gesture.** Swipe right to save, left to pass. The same muscle memory as Tinder, applied to company research. You can evaluate 50 companies in 5 minutes.
- **One export.** Save your watchlist and email it to yourself, export as CSV, or share individual companies. Your research goes where you go.

The thesis is simple: in a world drowning in AI hype, the most valuable tool is a curated, browsable, pocket-sized reference that respects your time.

---

## Who This Is For

| User | How They Use It |
|------|----------------|
| **VC / Angel Investors** | Swipe through categories to find deal flow. Filter by funding stage. Export watchlists for partner meetings. |
| **M&A Analysts** | Click the M&A Targets stat to see which companies are acquisition-ready ($100M+ funding or 5-star rating). Drill into funding bar charts by category. |
| **Tech Executives** | Browse the competitive landscape. See who's building what, who's funding them, and where the category leaders are. |
| **Founders** | Understand your competition. See how your funding compares. Find potential partners or acquirers in adjacent categories. |
| **Journalists & Researchers** | A-Z browsable directory of 623 companies with structured data. Export CSV for analysis. |
| **Anyone Curious About AI** | Swipe through cards like a discovery app. Learn about companies you've never heard of. Save the ones that interest you. |

---

## Features

### Swipe Mode

The core experience. Tap any company from the list to enter full-screen swipe mode.

| Gesture | Action | Visual Feedback |
|---------|--------|-----------------|
| **Swipe Right** | Save to watchlist | Green "SAVE" overlay |
| **Swipe Left** | Pass / skip | Red "PASS" overlay |
| **Swipe Up** | Quick save (same as right) | Green heart overlay |
| **Swipe Down** | Exit back to list view | Cyan "LIST" overlay |
| **Tap card** | Open full detail modal | Card expands |

Cards show real physics — they rotate as you drag, snap back if you don't commit, and fly off screen when you do. There's always a second card visible behind the current one so you know what's coming next.

**Keyboard shortcuts** (desktop): Arrow keys or `S`/`P` to save/pass, `Z` to undo, `Up` or `Enter` for detail view, `Escape` to exit.

### Company Cards

Each card shows at a glance:

- Company logo (pulled from their website favicon)
- Company name and product
- Health badge (Unicorn/Hot/Warm/Cold/Acquired/Closed)
- Investment raised (prominent banner)
- Star rating (1-5, tap for definitions)
- Category, HQ, founded year
- Description and key investors
- "Secret sauce" — what makes this company different

### Health Badges

Every company gets a health badge based on funding and status:

| Badge | Criteria | Meaning |
|-------|----------|---------|
| Unicorn | $1B+ funding | Elite tier, major player |
| Hot | $100M+ funding | High momentum, well-capitalized |
| Warm | $10M-100M funding | Growing, proven product-market fit |
| Cold | Under $10M | Early stage, high potential or high risk |
| Acquired | Company was acquired | Shows acquirer name |
| Closed | Company shut down | Historical reference |

### Star Ratings

An editorial 1-5 star rating on every company. Tap any rating to see definitions:

| Stars | Label | Meaning |
|-------|-------|---------|
| 5 | Exceptional | Category leader with strong momentum |
| 4 | Strong | Proven model, solid position |
| 3 | Promising | Early potential, worth watching |
| 2 | Experimental | Speculative, unproven |
| 1 | Risky | High uncertainty |

### Smart Filtering

The filter bar lets you slice the dataset instantly:

- **Health filters**: Unicorn ($1B+), Hot ($100M+), New (last 30 days), Acquired
- **Category dropdown**: 8 mobile-friendly categories — Foundation & Infra, Enterprise, Dev Tools, Consumer & Creative, Healthcare, Security, Finance & Legal, Industrial & Climate
- **Sort**: A-Z alphabetical or $$$ by funding amount (toggle direction)
- **Search**: Real-time full-text search across name, product, description, CEO, investors, HQ, category, and status. Matched terms are highlighted in gold.

### Clickable Stat Cards

The top stats aren't just numbers — they're drill-downs:

- **Companies** (tap) — Opens a full A-Z directory. Use the letter dropdown to jump. Tap any company to enter swipe mode at that position.
- **Total Funding** (tap) — Opens a horizontal bar chart showing funding distribution across 8 categories. See where the money is going.
- **M&A Targets** (tap) — Bar chart of acquisition-ready companies by category. Criteria: $100M+ funding or 5-star rating.

### Detail Modal

Tap any card (or press Up/Enter) for the full company profile:

- Logo, name, product, all key metrics
- Expandable sections: M&A Intelligence (3 AI-generated insights), Success Factors, Risks
- Funding timeline with rounds, amounts, and investors
- Action links: website, LinkedIn, clipboard copy
- Pass/Save buttons at the bottom

### Watchlist & Export

Your saved companies persist across sessions (localStorage). Open the watchlist to:

- **View by List or Category** — toggle between flat list and grouped view
- **Sort** — A-Z or by funding amount, ascending or descending
- **Analytics** — see your top 4 saved categories and total combined funding
- **Drag to reorder** — prioritize your list manually
- **Email export** — enter your email and receive a formatted HTML watchlist
- **CSV export** — download your saved list (or the full filtered deck) as a spreadsheet
- **Share** — copy any company's summary to clipboard, or use the native share sheet on mobile
- **Clear all** — with confirmation prompt

### A-Z Sidebar Navigation

The list view has an alphabetical sidebar. Tap any letter to jump to that section. Companies are grouped under letter headers with mini cards showing name, product, funding, and health badge.

### PWA Support

AI Book registers a service worker for offline caching. Add it to your home screen on iOS or Android for an app-like experience.

### Responsive Design

Works on any screen size. Optimized for mobile-first with touch gestures, but fully functional on desktop with mouse drag and keyboard shortcuts.

---

## The 8 Categories

| Category | Companies | What's Included |
|----------|-----------|-----------------|
| **Enterprise** | 133 | Enterprise AI platforms, GTM/sales AI, HR & talent tools |
| **Industrial & Climate** | 111 | Robotics, supply chain, energy, agriculture, space, ocean, real estate, travel |
| **Consumer & Creative** | 101 | Consumer apps, creative tools, photo/video/music/gaming/voice/text AI, education |
| **Foundation & Infra** | 82 | Foundation models, AI chips, infrastructure, agents, data platforms |
| **Developer Tools** | 74 | Coding assistants, DevOps AI, testing, deployment tools |
| **Finance & Legal** | 49 | Fintech, legal/compliance, insurance AI |
| **Healthcare** | 48 | Health tech, biotech AI, medical imaging, drug discovery |
| **Security** | 25 | Cybersecurity AI, threat detection, identity verification |

---

## Data

Every company entry includes:

```
Name, Product, Category, Founded Year, CEO, Funding Amount,
Star Rating, Website, HQ, Employees, Description,
Secret Sauce, Investors, Status, Acquired By (if applicable)
```

All data is stored in a single `companies.json` file (623 companies). The app fetches it on load with cache-busting to ensure freshness.

---

## Running Locally

```bash
git clone https://github.com/jjshay/ai-book.git
cd ai-book
python3 -m http.server 8767
# Open http://localhost:8767/aibook.html
```

No dependencies. No build step. No npm. Just HTML, CSS, JS, and a JSON file.

---

## Project Structure

```
ai-book/
  aibook.html             # The entire app (single file, ~3800 lines)
  companies.json          # 623 AI companies (the data)
  manifest.json           # PWA manifest
  sw.js                   # Service worker for offline support
  AI_BOOK_SWIPE_AppScript.js  # Google Apps Script for email export
  README.md               # This file
```

---

## Design Philosophy

**Why a single HTML file?** Zero friction. No build tools, no package managers, no framework lock-in. Anyone can fork it, read it, modify it, and deploy it anywhere — GitHub Pages, S3, a USB drive. The entire app is self-contained and works offline.

**Why swipe?** With 623 companies, users need to make quick binary decisions: interesting or not. Swipe UX reduces the decision to a physical gesture. It's fast, it's fun, and it turns research into something you can do on a subway.

**Why not a spreadsheet?** Spreadsheets are great for analysis but terrible for discovery. You can't browse a spreadsheet. You can't feel the momentum of a company in a row of cells. Cards give each company a moment of attention — logo, name, funding, and a one-line description. That's enough to decide.

**Why editorial ratings?** Automated scoring (by funding alone, or headcount, or press mentions) misses nuance. A 5-star rating is a human judgment call: is this company a category leader? Is it building something genuinely differentiated? The ratings are opinionated — that's the point.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | Vanilla HTML/CSS/JS | Zero dependencies, instant deploy, works everywhere |
| Data | JSON file | Portable, version-controlled, readable |
| Styling | CSS custom properties | Dark theme with gold accents, consistent tokens |
| Gestures | Touch Events API | Native mobile swipe with mouse fallback |
| Storage | localStorage | No backend needed for watchlists |
| Email | Google Apps Script | Free, reliable, serverless |
| Hosting | GitHub Pages | Free, fast CDN, auto-deploy on push |
| PWA | Service Worker | Offline support, home screen install |

---

## License

MIT
