# demo-palantir
Classroom exercise to understand Palantir

Serve the folder with `python3 -m http.server 8000` and open <http://127.0.0.1:8000/> for the landing page, both demos and all guides (or use the GitHub Pages site). Opening the files directly (`file://`) is not supported: Investigate (`demo/`) is written as native ES modules (`demo/js/`), which browsers only load over HTTP.

Design: Deep Culture project identity (ERC, University of Amsterdam), shared from `brand/`. Libraries are bundled in `vendor/`, so everything except the map tiles works offline.
