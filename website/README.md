# ShopFront Marketing Website

This folder is a standalone static site intended for Firebase Hosting.

## Files
- `index.html`: Main product page
- `privacy.html`: Placeholder privacy policy page
- `terms.html`: Placeholder terms and conditions page
- `styles.css`: Shared styles for all pages
- `script.js`: Lightweight UI interactions (reveal animations + stat counters)
- `firebase.json`: Firebase hosting config for this site

## Local Preview
Use any static server from this folder. Example:

```bash
cd website
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy to Firebase
From this `website/` directory:

```bash
firebase login
firebase init hosting
firebase deploy
```

When prompted:
- Use this folder (`website`) as the hosting project root
- Do not overwrite existing files
- Do not configure as SPA unless you plan to add a JS router

## Extensibility Notes
- Keep future pages as separate HTML files for legal/compliance needs
- Add components by sectioning shared styles into utility blocks in `styles.css`
- Move scripts into `website/js/` modules when interactions grow
