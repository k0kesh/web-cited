# Web Cited

Marketing site for **Web Cited** — a Search Experience Optimization (SXO)
consulting practice offering a $5,000 one-time audit. Audits only. No retainers.

## Structure

```
web-cited/
├── index.html
├── services.html
├── how-it-works.html
├── why-sxo.html
├── pricing.html
├── about.html
├── css/
│   └── styles.css
└── js/
    └── script.js
```

## Run locally

No build step, no dependencies. Open `index.html` directly in a browser,
or serve the directory with any static file server:

```bash
python3 -m http.server 3000
# then visit http://localhost:3000
```

## Stack

- Hand-written HTML, CSS, and vanilla JS
- Mobile-first CSS Grid + Flexbox
- System font stack (no external font CDN — Core Web Vitals optimized)
- WCAG 2.1 AA target

## Core Web Vitals (local dev)

- LCP: ~100ms
- CLS: 0
- FCP: ~100ms
- TBT: 0
- External requests: 0
