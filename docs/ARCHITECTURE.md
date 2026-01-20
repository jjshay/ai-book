# Architecture Deep Dive

This document explains how the AI Companies Platform is built, in plain English with code examples you can walk through in an interview.

---

## The Big Picture

Think of this platform like a **restaurant with two entrances**:

1. **Front Door (AI M&A Directory)** - The full sit-down experience. Dashboards, analytics, every detail.
2. **Food Truck Window (AI Book)** - Quick service. Swipe through companies on your phone.

Both serve the same menu (company data), but the experience is optimized for different situations.

```
┌──────────────────────────────────────────────────────────┐
│                     THE KITCHEN                          │
│                   (companies.json)                       │
│                                                          │
│   593 companies with funding, employees, descriptions    │
└──────────────────────────────────────────────────────────┘
                          │
                          │ fetch()
                          │
         ┌────────────────┴────────────────┐
         ▼                                 ▼
┌─────────────────────┐         ┌─────────────────────┐
│   FRONT DOOR        │         │   FOOD TRUCK        │
│   Desktop App       │         │   Mobile App        │
│                     │         │                     │
│   • Tables/Grids    │         │   • Card stack      │
│   • Multiple panels │         │   • Swipe gestures  │
│   • Complex filters │         │   • Quick save      │
└─────────────────────┘         └─────────────────────┘
```

---

## Data Flow: How Everything Connects

### Step 1: Load the Data

When either app opens, it fetches company data from the shared JSON file:

```javascript
// Both apps start the same way
async function loadData() {
    const response = await fetch('companies.json');
    companies = await response.json();
    console.log(`Loaded ${companies.length} companies`);
    init();  // Now build the UI
}
```

**Interview Talking Point:** "I designed this as a shared data layer so I could maintain one source of truth. When I update company info, both apps get it automatically."

### Step 2: Build the Deck

The "deck" is the filtered list of companies the user is currently viewing:

```javascript
function buildDeck() {
    // Start with all companies
    deck = [...companies];

    // Apply category filter (if set)
    if (currentFilter !== 'all') {
        deck = deck.filter(c => c.category === currentFilter);
    }

    // Apply funding tier filter (Unicorn, Hot, Rising)
    if (activeHealthFilter === 'unicorn') {
        deck = deck.filter(c => parseFunding(c.funding) >= 1000);  // $1B+
    }

    // Apply search
    if (searchQuery) {
        deck = deck.filter(c =>
            c.name.toLowerCase().includes(searchQuery) ||
            c.description.toLowerCase().includes(searchQuery)
        );
    }

    // Update the UI to reflect filtered results
    updateVanityStats();
    renderList();
}
```

**Interview Talking Point:** "The buildDeck function is the heart of the filtering system. Every user action—search, filter, sort—rebuilds the deck and refreshes the view."

### Step 3: Render the View

Desktop and Mobile render differently, but the logic is similar:

```javascript
// Desktop: Render as cards in a grid
function renderCards() {
    const container = document.getElementById('cards');
    container.innerHTML = deck.map(company => `
        <div class="card" onclick="openDetail(${company.id})">
            <h3>${company.name}</h3>
            <p>${company.product}</p>
            <span class="funding">${company.funding}</span>
        </div>
    `).join('');
}

// Mobile: Render as a stack (only top 3 visible)
function renderStack() {
    const stack = document.getElementById('stack');
    stack.innerHTML = deck.slice(0, 3).map((company, i) => `
        <div class="swipe-card" style="z-index: ${3-i}">
            <h2>${company.name}</h2>
            <p>${company.secretSauce}</p>
        </div>
    `).join('');
    setupSwipeGestures();
}
```

---

## The Swipe System (Mobile)

This is the most technically interesting part. Here's how Tinder-style swipe works:

### 1. Track the Touch Start

```javascript
let startX, startY;

function onTouchStart(e) {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    card.style.transition = 'none';  // Disable animation during drag
}
```

### 2. Move the Card with the Finger

```javascript
function onTouchMove(e) {
    const currentX = e.touches[0].clientX - startX;
    const currentY = e.touches[0].clientY - startY;

    // Rotate card slightly based on horizontal movement
    const rotation = currentX * 0.1;

    card.style.transform = `
        translateX(${currentX}px)
        translateY(${currentY}px)
        rotate(${rotation}deg)
    `;

    // Show visual feedback
    if (currentX > 50) {
        card.querySelector('.save-overlay').style.opacity = currentX / 100;
    } else if (currentX < -50) {
        card.querySelector('.pass-overlay').style.opacity = Math.abs(currentX) / 100;
    }
}
```

### 3. Decide What Happens on Release

```javascript
function onTouchEnd(e) {
    const deltaX = e.changedTouches[0].clientX - startX;
    const deltaY = e.changedTouches[0].clientY - startY;

    card.style.transition = 'transform 0.3s ease';  // Re-enable animation

    if (deltaX > 100) {
        // Swiped RIGHT - Save the company
        flyCardRight();
        saveToWatchlist(currentCompany);
    } else if (deltaX < -100) {
        // Swiped LEFT - Pass
        flyCardLeft();
        nextCompany();
    } else if (deltaY > 100) {
        // Swiped DOWN - Back to list
        exitSwipeMode();
    } else {
        // Didn't swipe far enough - snap back
        card.style.transform = 'translateX(0) rotate(0)';
    }
}
```

**Interview Talking Point:** "I used the Touch Events API to track finger position, then applied CSS transforms for the visual movement. The 100-pixel threshold prevents accidental swipes."

---

## The M&A Scoring System (Desktop)

The desktop app calculates how "hot" a company is based on hiring signals:

### The Scoring Formula

```javascript
function calculateHiringScore(company) {
    const jobs = company.jobs || [];

    // Count jobs by type
    const engineering = jobs.filter(j => j.type === 'engineering').length;
    const gtm = jobs.filter(j => j.type === 'gtm').length;           // Sales/Marketing
    const leadership = jobs.filter(j => j.type === 'leadership').length;

    // Calculate weighted score
    const score =
        (jobs.length * 30) +        // Base: every job posting = interest
        (engineering * 15) +         // Bonus: engineering = building
        (gtm * 13) +                 // Bonus: GTM = scaling
        (leadership * 20);           // Bonus: leadership = big moves

    return score;
}
```

### Why These Weights?

| Job Type | Weight | Reasoning |
|----------|--------|-----------|
| Any Job | 30 | Company is active and growing |
| Engineering | +15 | Building product = increasing value |
| GTM (Sales/Marketing) | +13 | Preparing to scale revenue |
| Leadership | +20 | C-suite hires often precede M&A or funding |

**Interview Talking Point:** "I reverse-engineered what signals matter for M&A. Heavy engineering hiring means they're building value. Leadership hiring often precedes a transaction."

---

## The Watchlist & Email System

### Saving Companies (localStorage)

```javascript
function saveToWatchlist(company) {
    // Get existing watchlist from browser storage
    let saved = JSON.parse(localStorage.getItem('watchlist') || '[]');

    // Add new company (avoid duplicates)
    if (!saved.find(c => c.id === company.id)) {
        saved.push(company);
        localStorage.setItem('watchlist', JSON.stringify(saved));
    }

    updateWatchlistBadge();
}
```

**Why localStorage?** No backend needed. Data persists even if user closes browser.

### Sending the Email (Google Apps Script)

The email is sent via a serverless Google Apps Script:

```javascript
// Frontend: Send watchlist to Google Apps Script
async function sendWatchlist(email) {
    const saved = JSON.parse(localStorage.getItem('watchlist') || '[]');

    await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec', {
        method: 'POST',
        body: JSON.stringify({
            email: email,
            companies: saved
        })
    });
}
```

```javascript
// Google Apps Script: Receive and send email
function doPost(e) {
    const data = JSON.parse(e.postData.contents);
    const html = generateEmailHTML(data.companies);

    GmailApp.sendEmail(
        data.email,
        `AI Book - Your Watchlist (${data.companies.length} companies)`,
        'View in HTML',
        { htmlBody: html }
    );

    return ContentService.createTextOutput('OK');
}
```

**Interview Talking Point:** "I used Google Apps Script as a free serverless backend. It receives the watchlist, formats it as HTML, and sends via Gmail—no server infrastructure needed."

---

## State Management (Simple but Effective)

I don't use Redux or any state library. Just well-organized variables:

```javascript
// Global state
let companies = [];          // Master list (from JSON)
let deck = [];               // Filtered list (what user sees)
let saved = [];              // Watchlist
let currentFilter = 'all';   // Category filter
let activeHealthFilter = null;  // Funding tier filter
let searchQuery = '';        // Search term
let deckSortMode = 'none';   // Sort: none, alpha, funding

// Every action rebuilds the deck
function applyFilters() {
    buildDeck();      // Rebuild filtered list
    renderView();     // Re-render UI
    updateStats();    // Update counters
}
```

**Interview Talking Point:** "For a project this size, a simple state model with clear rebuild points is more maintainable than a complex state management library."

---

## Performance Considerations

### 1. Lazy Rendering

Don't render all 593 cards. Only render what's visible:

```javascript
// Mobile: Only render top 3 cards in stack
function renderStack() {
    return deck.slice(0, 3).map(renderCard);
}

// Desktop: Virtual scroll would be used for 1000+ items
```

### 2. Debounced Search

Don't filter on every keystroke:

```javascript
let searchTimeout;
function onSearchInput(e) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        searchQuery = e.target.value;
        buildDeck();
    }, 200);  // Wait 200ms after typing stops
}
```

### 3. CSS Transitions, Not JS Animation

Let the browser handle animations:

```css
.swipe-card {
    transition: transform 0.3s ease, opacity 0.3s ease;
}
```

**Interview Talking Point:** "I let CSS handle animations because it's hardware-accelerated. JavaScript just changes the values—the browser optimizes the actual rendering."

---

## Security Considerations

1. **No sensitive data in JSON** - All company info is public
2. **Email validation** - Basic regex before sending
3. **CORS handled by Apps Script** - Google manages this
4. **localStorage only** - No cookies, no tracking

---

## Deployment

The entire platform is **static files**. Deploy anywhere:

```bash
# Option 1: Vercel (recommended)
vercel deploy

# Option 2: Netlify
netlify deploy

# Option 3: GitHub Pages
git push origin main  # Auto-deploys

# Option 4: Any web server
scp *.html *.json user@server:/var/www/html/
```

**Interview Talking Point:** "No build step means deployment is just copying files. The entire platform loads in under 2 seconds on a 3G connection."
