# Feature Guide

A detailed walkthrough of every feature, with code snippets and explanations.

---

## Table of Contents
1. [Smart Filtering System](#1-smart-filtering-system)
2. [Health Badges (Unicorn/Hot/Rising)](#2-health-badges)
3. [A-Z Sidebar Navigation](#3-a-z-sidebar)
4. [Swipe Gestures](#4-swipe-gestures)
5. [Dynamic Vanity Stats](#5-dynamic-vanity-stats)
6. [Watchlist Management](#6-watchlist-management)
7. [Email Export](#7-email-export)
8. [Data Deduplication](#8-data-deduplication)

---

## 1. Smart Filtering System

### What It Does
Users can filter 593 companies by category, funding tier, and search query—all filters work together.

### The Code

```javascript
// Main filter function - called whenever any filter changes
function buildDeck() {
    // Start fresh with all companies
    deck = currentFilter === 'all'
        ? [...companies]
        : companies.filter(c => c.category === currentFilter);

    // Apply funding tier filter
    if (activeHealthFilter) {
        deck = deck.filter(c => {
            const funding = parseFundingAmount(c.funding);
            if (activeHealthFilter === 'unicorn') return funding >= 1000;
            if (activeHealthFilter === 'hot') return funding >= 100;
            if (activeHealthFilter === 'rising') return funding >= 10 && funding < 100;
            return true;
        });
    }

    // Apply search
    if (searchQuery) {
        deck = deck.filter(c =>
            c.name.toLowerCase().includes(searchQuery) ||
            c.product?.toLowerCase().includes(searchQuery) ||
            c.description?.toLowerCase().includes(searchQuery)
        );
    }

    // Update everything
    renderView();
    updateVanityStats();
}
```

### How to Explain It
> "Every filter action calls buildDeck(). It starts with all companies, then applies each filter in sequence like a pipeline. Category first, then funding tier, then search. This 'filter chaining' approach is clean and easy to extend."

---

## 2. Health Badges

### What It Does
Each company gets a colored badge based on funding: Unicorn (purple), Hot (orange), Rising (green), or Early (gray).

### The Code

```javascript
function getHealthBadge(company) {
    const funding = parseFundingAmount(company.funding);

    if (funding >= 1000) {
        return {
            class: 'unicorn',
            icon: '🦄',
            label: 'Unicorn',
            tooltip: '$1B+ Elite'
        };
    }

    if (funding >= 100) {
        return {
            class: 'hot',
            icon: '🔥',
            label: 'Hot',
            tooltip: 'Strong Momentum'
        };
    }

    if (funding >= 10) {
        return {
            class: 'warm',
            icon: '📈',
            label: 'Rising',
            tooltip: 'Rising Star ($10M-$100M)'
        };
    }

    return {
        class: 'cold',
        icon: '❄️',
        label: 'Early',
        tooltip: 'Early Stage'
    };
}
```

### The CSS

```css
.health-badge.unicorn {
    background: linear-gradient(135deg, #a855f7, #ec4899);
    color: #fff;
}

.health-badge.hot {
    background: linear-gradient(135deg, #f97316, #ef4444);
    color: #fff;
}

.health-badge.warm {
    background: linear-gradient(135deg, #eab308, #f59e0b);
    color: #1a1a1a;
}
```

### How to Explain It
> "I created a visual hierarchy so users can instantly spot high-value companies. The gradients draw the eye. Unicorns get purple because it's rare and premium. Hot gets fire colors. It's visual design serving the data."

---

## 3. A-Z Sidebar

### What It Does
A vertical letter bar lets users jump to any section of the alphabetical list. Letters light up cyan on hover and when active.

### The Code

```javascript
function renderAZSidebar() {
    const sidebar = document.getElementById('az-sidebar');

    // Count companies per letter
    const letterCounts = {};
    deck.forEach(c => {
        const letter = c.name.charAt(0).toUpperCase();
        letterCounts[letter] = (letterCounts[letter] || 0) + 1;
    });

    // Render A-Z
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    sidebar.innerHTML = letters.map(letter => {
        const hasItems = letterCounts[letter] > 0;
        const isActive = letter === currentLetter;
        return `
            <div class="az-letter ${hasItems ? 'has-items' : ''} ${isActive ? 'active' : ''}"
                 onclick="scrollToLetter('${letter}')">
                ${letter}
            </div>
        `;
    }).join('');
}

function scrollToLetter(letter) {
    currentLetter = letter;
    renderAZSidebar();  // Update active state

    const section = document.getElementById(`section-${letter}`);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}
```

### The CSS

```css
.az-letter {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    transition: all 0.15s ease;
}

.az-letter:hover,
.az-letter.active {
    color: var(--cyan);
    font-size: 16px;
    transform: scale(1.3);
    text-shadow: 0 0 10px rgba(0,206,209,0.6);
}

.az-letter.has-items {
    color: rgba(255,255,255,0.7);
}
```

### How to Explain It
> "With 593 companies, scrolling is tedious. The A-Z bar is like a book index—tap a letter, jump to that section. Dim letters mean no companies start with that letter. The cyan glow provides satisfying feedback."

---

## 4. Swipe Gestures

### What It Does
Mobile users swipe cards right to save, left to pass, down to exit. The card follows the finger with rotation.

### The Code (Simplified)

```javascript
function setupSwipeGestures() {
    const card = document.querySelector('.swipe-card');
    let startX, startY, currentX, currentY;

    card.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        card.style.transition = 'none';
    });

    card.addEventListener('touchmove', e => {
        currentX = e.touches[0].clientX - startX;
        currentY = e.touches[0].clientY - startY;

        // Card follows finger with slight rotation
        const rotation = currentX * 0.1;
        card.style.transform = `
            translateX(${currentX}px)
            translateY(${currentY}px)
            rotate(${rotation}deg)
        `;

        // Show overlays based on direction
        updateOverlays(currentX, currentY);
    });

    card.addEventListener('touchend', e => {
        card.style.transition = 'transform 0.3s ease';

        if (currentX > 100) {
            flyCardAndSave();
        } else if (currentX < -100) {
            flyCardAndPass();
        } else if (currentY > 100) {
            exitToList();
        } else {
            snapBack();
        }
    });
}
```

### How to Explain It
> "The swipe mechanic uses the Touch Events API. I track the delta from touch start, apply it as a CSS transform, and add rotation proportional to horizontal movement—that's what makes it feel physical. The 100-pixel threshold prevents accidental actions."

---

## 5. Dynamic Vanity Stats

### What It Does
The header shows "X Companies | $YB+ Raised | Z M&A Targets"—and these numbers update when filters change.

### The Code

```javascript
function updateVanityStats() {
    let totalFunding = 0;
    let maTargets = 0;

    // Only count companies in current filtered deck
    deck.forEach(c => {
        const funding = parseFundingAmount(c.funding);
        totalFunding += funding;

        // M&A target criteria: well-funded OR high rating
        if (funding > 100 || c.rating >= 4) {
            maTargets++;
        }
    });

    // Format funding (show as B if >= 1000M)
    const fundingDisplay = totalFunding >= 1000
        ? `$${Math.round(totalFunding / 1000)}B+`
        : `$${Math.round(totalFunding)}M+`;

    // Update DOM
    document.getElementById('stat-companies').textContent = deck.length;
    document.getElementById('stat-funding').textContent = fundingDisplay;
    document.getElementById('stat-ma').textContent = maTargets;
}
```

### How to Explain It
> "Users wanted to know 'what's the value of just the Unicorns?' So I made stats reactive. Filter to Unicorns, and you instantly see: 45 companies, $120B+ raised, 40 M&A targets. It makes filtering feel powerful."

---

## 6. Watchlist Management

### What It Does
Saved companies persist in browser storage. Users can reorder via drag-and-drop, remove items, or clear all.

### The Code

```javascript
// Save a company
function saveToWatchlist(company) {
    if (!saved.find(c => c.id === company.id)) {
        saved.push(company);
        localStorage.setItem('ai_tracker_saved', JSON.stringify(saved));
        updateUI();
    }
}

// Remove a company
function removeSaved(id) {
    saved = saved.filter(c => c.id !== id);
    localStorage.setItem('ai_tracker_saved', JSON.stringify(saved));
    renderSavedList();
}

// Clear all
function clearAllSaved() {
    if (confirm('Clear all saved companies?')) {
        saved = [];
        localStorage.setItem('ai_tracker_saved', JSON.stringify(saved));
        renderSavedList();
    }
}

// Load on startup
function loadSaved() {
    saved = JSON.parse(localStorage.getItem('ai_tracker_saved') || '[]');
}
```

### How to Explain It
> "I use localStorage so the watchlist survives browser closes—no account needed. The trade-off is it's device-specific, but for a research tool that's fine. The email export solves cross-device sharing."

---

## 7. Email Export

### What It Does
Users enter their email and receive a beautifully formatted HTML email with all saved companies.

### The Frontend

```javascript
async function submitEmail() {
    const email = document.getElementById('email-input').value;

    // Basic validation
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        alert('Please enter a valid email');
        return;
    }

    // Send to Google Apps Script
    await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({
            email: email,
            companies: saved
        })
    });

    alert('Watchlist sent to ' + email);
}
```

### The Google Apps Script

```javascript
function doPost(e) {
    const data = JSON.parse(e.postData.contents);

    // Deduplicate by name
    const seen = {};
    const unique = data.companies.filter(c => {
        if (seen[c.name]) return false;
        seen[c.name] = true;
        return true;
    });

    // Generate HTML email
    const html = buildEmailHTML(unique);

    // Send via Gmail
    GmailApp.sendEmail(
        data.email,
        `AI BOOK - Your Watchlist (${unique.length} companies)`,
        'View in HTML format',
        { htmlBody: html }
    );

    return ContentService.createTextOutput('OK');
}
```

### How to Explain It
> "Google Apps Script acts as a free serverless backend. The frontend sends JSON, Apps Script formats it as HTML and sends via Gmail. No server to maintain, no costs, and Gmail deliverability is excellent."

---

## 8. Data Deduplication

### What It Does
Prevents "Adept" and "Adept AI" from both appearing. Normalizes names before comparison.

### The Code

```javascript
function normalizeName(name) {
    return name.toLowerCase()
        .replace(/\s*(ai|labs|inc|corp|llc|\.ai|\.io|\.com|technologies|tech)\.?\s*$/gi, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

// In buildDeck()
const seen = new Set();
deck = deck.filter(c => {
    const normalized = normalizeName(c.name);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
});
```

### What Gets Normalized

| Original | Normalized | Result |
|----------|------------|--------|
| Adept AI | adept | Kept |
| Adept | adept | Removed (duplicate) |
| Scale AI | scale | Kept |
| Scale.ai | scale | Removed (duplicate) |

### How to Explain It
> "Company names are inconsistent across sources—'Adept' in one database, 'Adept AI' in another. I normalize by stripping common suffixes and punctuation. This caught 112 duplicates in my 800-company dataset."

---

## Summary: The Interview Pitch

> "I built a platform that tracks 593 private AI companies worth over $150 billion. The desktop version is a full M&A intelligence dashboard with hiring signals and scoring. The mobile version is a Tinder-style swipe interface for quick research.
>
> Both apps share one JSON data file—single source of truth. No framework, no build step, just HTML/CSS/JS that deploys anywhere.
>
> The interesting technical bits: touch gesture physics for the swipe cards, a scoring algorithm that predicts M&A activity from hiring patterns, and a serverless email system using Google Apps Script.
>
> I spent as much time on data quality as features—deduplication, removing public companies, normalizing names. Because the best UX in the world doesn't matter if the data is garbage."
