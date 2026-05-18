# Deploying the Demos to GitHub Pages

This guide deploys both apps as a single static site so your students get **one URL each** with no install:

- `https://<your-github-username>.github.io/<repo-name>/demo/` — Gotham-style investigation demo
- `https://<your-github-username>.github.io/<repo-name>/foundry-demo/` — Foundry-style pipeline/lineage demo

Everything in this repo is static HTML/JS/CSS. GitHub Pages hosts it for free with no build step.

## 1. Prerequisites

- A free GitHub account
- Git installed locally (`git --version` should print something)
- The two `seed.js` files already built and present:
  - `demo/seed.js` (Gotham)
  - `foundry-demo/seed.js` (Foundry)

If either is missing or stale, rebuild before pushing:

```bash
python3 scripts/build_ontology_seed.py --output demo/seed.js
python3 scripts/build_foundry_seed.py --output foundry-demo/seed.js
```

The seed files **must** be committed to the repo — GitHub Pages does not run Python.

## 2. Put the repo on GitHub

From the project root:

```bash
git init
git add .
git commit -m "Initial commit"
```

Create a new empty repo on GitHub (no README, no .gitignore, no license — keep it empty so the push works cleanly). Then:

```bash
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

You can make the repo **public or private** — GitHub Pages serves either, as long as your account tier allows Pages on private repos (free tier supports public; private Pages requires GitHub Pro or higher).

## 3. Enable GitHub Pages

On GitHub:

1. Open the repo page
2. Go to **Settings → Pages** (left sidebar)
3. Under **Source**, choose **Deploy from a branch**
4. Under **Branch**, pick `main` and folder `/ (root)`
5. Click **Save**

Within ~1 minute the page will refresh and show a green box with the URL:

```
Your site is live at https://<your-username>.github.io/<repo-name>/
```

## 4. Share with students

Give students the two direct URLs:

- Gotham: `https://<your-username>.github.io/<repo-name>/demo/`
- Foundry: `https://<your-username>.github.io/<repo-name>/foundry-demo/`

The trailing slash matters — `index.html` is implied.

## 5. Optional: add a landing page

If you also want the bare repo URL (`.../<repo-name>/`) to show a small menu instead of a 404, create `index.html` at the repo root with this content:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Palantir-style Classroom Demos</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 4rem auto; padding: 0 1rem; line-height: 1.55; color: #1e293b; }
    h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
    p.lede { color: #64748b; margin-top: 0; }
    .card { display: block; padding: 1rem 1.25rem; margin-top: 1rem; border: 1px solid #e2e8f0; border-radius: 8px; text-decoration: none; color: inherit; transition: border-color 0.15s; }
    .card:hover { border-color: #3b82f6; }
    .card h2 { margin: 0 0 0.25rem; font-size: 1.1rem; color: #3b82f6; }
    .card p { margin: 0; color: #64748b; font-size: 0.95rem; }
  </style>
</head>
<body>
  <h1>Palantir-style Classroom Demos</h1>
  <p class="lede">Two paired demos for teaching how operational intelligence platforms work.</p>

  <a class="card" href="./demo/">
    <h2>Gotham Studio →</h2>
    <p>Ontology, investigations, AI copilot, geospatial map. Start here.</p>
  </a>

  <a class="card" href="./foundry-demo/">
    <h2>Foundry Studio →</h2>
    <p>Pipelines, datasets, and end-to-end lineage. Run after the Gotham session.</p>
  </a>
</body>
</html>
```

Commit and push it — Pages picks it up automatically.

## 6. Updating the site

Any time you change code, regenerate seeds (if data changed), commit, and push:

```bash
python3 scripts/build_ontology_seed.py --output demo/seed.js          # if Gotham data changed
python3 scripts/build_foundry_seed.py --output foundry-demo/seed.js   # if Foundry data changed
git add .
git commit -m "Describe the change"
git push
```

GitHub redeploys within ~1 minute. Students just need to refresh the page.

## 7. Notes for the classroom

- **Internet required** at first load — for Leaflet's JS/CSS (loaded from unpkg CDN) and the OpenStreetMap tile images on the map tab. Once a student has loaded the page, the rest works offline because the seed data is bundled into `seed.js`.
- **Browser support**: any modern desktop browser. Mobile works but the layouts are designed for laptop screens.
- **No telemetry / no accounts** — students do not need to sign in to anything. Their browser-local state (selections, action log, etc.) stays on their device in `localStorage`.
- **The synthetic_data, scripts, and pipeline directories also get published** to the same site. This is fine — they're not linked from anywhere — but if you'd prefer to exclude them, add a top-level `.nojekyll` file and a custom Jekyll config, or move them out of the repo before pushing.
- **Cost**: GitHub Pages is free for public repos with generous bandwidth limits (~100 GB/month soft cap). A classroom of 50 students hitting the site once each uses well under 0.1% of that.
