# OPUS to MP3 Converter - GitHub Pages Single Thread

This version is designed for GitHub Pages.

Why this version:
- GitHub Pages cannot run PHP
- GitHub Pages also cannot set the headers needed for SharedArrayBuffer
- so this package uses ffmpeg.wasm single-thread core

Files:
- index.html
- ffmpeg.js
- .nojekyll
- README.md

Notes:
- `ffmpeg.js` is now a single local wrapper file with its worker code embedded
- there is no separate `814.ffmpeg.js` chunk anymore
- `index.html` now includes local `fetchFile` and `toBlobURL` helpers instead of loading `@ffmpeg/util`
