# OPUS to MP3 Converter

Static GitHub Pages build for converting OPUS-like audio files to MP3 in the
browser.

Why this version:
- GitHub Pages cannot run server-side conversion
- Firefox and some other browsers can block cross-origin FFmpeg worker loading
- this version uses Web Audio for decoding and `lamejs` for MP3 encoding

Files:
- [index.html](./index.html)
- [styles.css](./styles.css)
- [app.js](./app.js)
- [.nojekyll](./.nojekyll)
