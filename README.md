# OPUS to MP3 Converter - GitHub Pages Single Thread

This version is designed for GitHub Pages.

Why this version:
- GitHub Pages cannot run PHP
- GitHub Pages also cannot set the headers needed for SharedArrayBuffer
- so this package uses ffmpeg.wasm single-thread core

Files:
- index.html
- .nojekyll
- README.md
