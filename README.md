# AI Companies Intelligence Platform

> A comprehensive M&A signals and company intelligence platform tracking 593 private AI companies with $150B+ in combined funding.

![Platform Preview](docs/images/preview.png)

## What I Built

Two interconnected applications that help investors, analysts, and M&A professionals discover and evaluate AI companies:

| Application | Purpose | Key Innovation |
|-------------|---------|----------------|
| **AI M&A Directory** | Desktop intelligence dashboard | Real-time hiring signals, funding analysis, M&A scoring |
| **AI Book** | Mobile-first discovery app | Tinder-style swipe interface for company research |

Both apps share a **single source of truth** (`companies.json`) - edit once, updates everywhere.

---

## The Problem I Solved

**Challenge:** AI companies are raising billions, but tracking which ones are acquisition targets is nearly impossible. Data is scattered across LinkedIn, job boards, news sites, and funding databases.

**My Solution:** A unified platform that:
- Aggregates 593 private AI companies in one place
- Calculates "M&A readiness" scores based on hiring patterns
- Provides mobile-friendly research for on-the-go analysis
- Emails personalized watchlists to users

---

## Key Features

### 1. M&A Signals Engine
The platform calculates a **hiring score** for each company based on:

```javascript
// Simplified scoring logic
score = (careerPageJobs * 30) +           // Base job count
        (engineeringJobs * 15) +          // Engineering = building product
        (gtmJobs * 13) +                  // GTM = preparing to scale
        (leadershipJobs * 20) -           // Leadership = major moves
        (removedJobs * 10);               // Removals = potential trouble
```

**Why This Matters:** Companies hiring aggressively in engineering + GTM + leadership often signal:
- Preparing for acquisition (building value)
- About to raise funding
- Scaling for IPO

### 2. Smart Filtering System
Filter 593 companies by:
- **Category** (Foundation Models, Enterprise AI, HealthTech, etc.)
- **Funding Stage** (Unicorn $1B+, Hot $100M+, Rising $10M-100M)
- **Alphabetical** or **Funding Amount** sorting

```javascript
// Health badge classification
if (funding >= 1000) return 'Unicorn';      // $1B+ elite
if (funding >= 100)  return 'Hot';          // $100M+ momentum
if (funding >= 10)   return 'Rising';       // $10M-100M growth
return 'Early';                              // Early stage
```

### 3. Mobile Swipe Interface
Inspired by Tinder's UX, but for company research:

```javascript
// Gesture detection
if (deltaX > 100)  saveCompany();    // Swipe RIGHT = Save to watchlist
if (deltaX < -100) passCompany();    // Swipe LEFT = Pass
if (deltaY > 100)  exitToList();     // Swipe DOWN = Back to list
```

**Why Swipe?** With 593 companies, users need to make quick decisions. Swipe UX reduces cognitive load and makes research feel effortless.

### 4. Watchlist & Email Export
Users can:
1. Save companies to a personal watchlist
2. Enter their email
3. Receive a beautifully formatted HTML email with all saved companies

```javascript
// Email sent via Google Apps Script
GmailApp.sendEmail(email, subject, plainText, {
    htmlBody: generateEmailHTML(companies)
});
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    DATA LAYER                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  companies.json (593 companies - Single Source)     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│   AI M&A Directory  │         │      AI Book        │
│   (Desktop App)     │         │   (Mobile App)      │
├─────────────────────┤         ├─────────────────────┤
│ • Full dashboard    │         │ • Swipe interface   │
│ • Hiring signals    │         │ • Quick discovery   │
│ • M&A scoring       │         │ • Watchlist         │
│ • LinkedIn panel    │         │ • Email export      │
│ • Job tracking      │         │ • A-Z navigation    │
└─────────────────────┘         └─────────────────────┘
            │                               │
            └───────────────┬───────────────┘
                            ▼
            ┌─────────────────────────────┐
            │   Google Apps Script API    │
            │   (Email delivery)          │
            └─────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Why I Chose It |
|-------|------------|----------------|
| **Frontend** | Vanilla JS + CSS | Zero dependencies = fast load, easy deploy |
| **Data** | JSON | Simple, portable, version-controllable |
| **Styling** | CSS Variables | Dark theme, consistent design tokens |
| **Gestures** | Touch Events API | Native mobile swipe support |
| **Email** | Google Apps Script | Free, reliable, no backend needed |
| **Hosting** | Static files | Works anywhere (Vercel, Netlify, S3) |

**Philosophy:** No React, no build step, no npm. Just HTML/CSS/JS that works everywhere.

---

## Data Model

Each company in the database:

```javascript
{
    "id": 1,
    "name": "OpenAI",
    "product": "ChatGPT / GPT-4",
    "category": "foundation-models",
    "founded": 2015,
    "ceo": "Sam Altman",
    "funding": "$11B+",
    "rating": 5,
    "website": "openai.com",
    "hq": "San Francisco, CA",
    "employees": "2,000-3,000",
    "description": "The company that started the generative AI revolution...",
    "secretSauce": "Category creator + consumer habit + enterprise API dominance"
}
```

**37 categories** including:
- Foundation Models, Enterprise AI, Developer Tools
- HealthTech, FinTech, Industrial AI
- Consumer AI, Security AI, Climate/AgTech

---

## Code Highlights

### Dynamic Stats That Update on Filter

When users filter by category or funding tier, the stats update instantly:

```javascript
function updateVanityStats() {
    let totalFunding = 0;
    let maTargets = 0;

    // Only count companies in current filtered view
    deck.forEach(company => {
        totalFunding += parseFundingAmount(company.funding);

        // M&A target = well-funded OR high rating
        if (funding > 100 || company.rating >= 4) {
            maTargets++;
        }
    });

    // Update the UI
    document.getElementById('stat-companies').textContent = deck.length;
    document.getElementById('stat-funding').textContent = formatFunding(totalFunding);
    document.getElementById('stat-ma').textContent = maTargets;
}
```

### Smart Deduplication

Companies appear under various names ("Adept" vs "Adept AI"). The system normalizes:

```javascript
function normalizeName(name) {
    return name.toLowerCase()
        .replace(/\s*(ai|labs|inc|corp|\.ai|\.io)$/gi, '')  // Remove suffixes
        .replace(/[^a-z0-9]/g, '')                          // Keep alphanumeric
        .trim();
}

// "Adept AI" and "Adept" both become "adept" = detected as duplicate
```

### Touch Gesture Recognition

Mobile swipe detection with visual feedback:

```javascript
function handleTouchMove(e) {
    const deltaX = e.touches[0].clientX - startX;
    const deltaY = e.touches[0].clientY - startY;

    // Rotate card based on swipe direction
    const rotation = deltaX * 0.1;
    card.style.transform = `translateX(${deltaX}px) rotate(${rotation}deg)`;

    // Show SAVE/PASS overlay based on direction
    if (deltaX > 50) {
        showOverlay('SAVE', 'green');
    } else if (deltaX < -50) {
        showOverlay('PASS', 'red');
    }
}
```

---

## Running Locally

```bash
# Clone the repository
git clone https://github.com/yourusername/ai-companies-platform.git
cd ai-companies-platform

# Start local server (Python 3)
python3 -m http.server 9000

# Open in browser
open http://localhost:9000/AI_MA_Directory.html  # Desktop version
open http://localhost:9000/aibook.html           # Mobile version
```

No npm install. No build step. Just serve and go.

---

## Project Structure

```
ai-companies-platform/
├── README.md                    # You're reading it
├── companies.json               # Master data (593 companies)
├── AI_MA_Directory.html         # Desktop M&A dashboard
├── aibook.html                  # Mobile swipe app
├── AI_BOOK_SWIPE_AppScript.js   # Google Apps Script for email
└── docs/
    ├── ARCHITECTURE.md          # Detailed system design
    ├── FEATURES.md              # Feature breakdown
    └── images/                  # Screenshots
```

---

## What I Learned

1. **Single source of truth matters** - Two apps, one JSON file. Edit once, deploy everywhere.

2. **Vanilla JS is underrated** - No framework = no build step = deploy anywhere instantly.

3. **Mobile-first gestures** - Touch events are surprisingly simple. The hard part is the physics (card rotation, snap-back animation).

4. **Data quality is everything** - I spent more time deduplicating and cleaning data than writing features.

---

## Future Enhancements

- [ ] Real-time job posting ingestion via API
- [ ] LinkedIn hiring trend integration
- [ ] Push notifications for watchlist companies
- [ ] Collaborative watchlists for teams

---

## Contact

Built by [Your Name] - [your@email.com]

Portfolio: [yoursite.com](https://yoursite.com)
