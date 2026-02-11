# Double Ctrl

A Chrome extension that lets you **double-press Ctrl** to magnify any image on a webpage — inspired by Microsoft Edge's built-in Magnify feature.

Works on regular images, deeply nested images hidden behind overlay divs (WhatsApp, Telegram), blob URLs, srcset responsive images, and CSS background images.

## Install

1. Clone or download this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `double-ctrl` folder

## Usage

Hover over any image and **press Ctrl twice quickly**.

A dark overlay appears with the magnified image. From there you can:

- **Zoom** with scroll wheel / trackpad pinch, or use the +/- buttons (levels: 0.5x, 1x, 2x, 4x, 8x)
- **Pan** by click-dragging when zoomed in
- **Copy** the image to clipboard
- **Save** the image to disk
- **Close** by pressing Escape, clicking the X, or clicking outside the image

## Why this exists

Chrome has no equivalent to Edge's Magnify feature. Worse, many web apps (WhatsApp Web, Telegram Web) make it hard to interact with images directly:

- Images buried deep inside nested divs
- Transparent overlay divs blocking right-click
- Multiple stacked images (low-res preview + full-res blob)
- Blob URLs that can't be easily saved

This extension handles all of these by scanning the full DOM element stack at the cursor position, collecting every candidate image, and ranking them by quality:

| URL type | Score | Reason |
|---|---|---|
| `blob:` | Highest | Almost always the full-resolution image |
| `https:` | Medium | Standard web images |
| `data:` base64 | Lowest | Usually tiny previews or blur placeholders |

Natural image dimensions and display area are also factored in, so the largest, highest-quality image wins.

## How it works

- **Detection**: `document.elementsFromPoint()` returns every element at the cursor — not just the topmost. This pierces through overlay divs.
- **Child search**: For each element in the stack, searches all descendant `<img>`, `<picture>`, `<svg>` elements and CSS `background-image` properties.
- **Ranking**: Candidates are scored by URL type, natural pixel dimensions, and display area. Deduplication prevents the same image from appearing twice.
- **Blob URL handling**: Copy and save work with blob URLs by capturing the already-rendered image from the overlay via canvas, since `fetch()` can't access blobs from another JS context.

## Files

```
manifest.json   - Chrome MV3 extension config
content.js      - All client-side logic (~600 lines)
content.css     - Overlay styles
background.js   - Service worker for chrome.downloads API
icons/          - Extension icons (16, 32, 48, 128px)
```

No build tools, no dependencies, no frameworks. Plain JS/CSS.

## Permissions

- **`downloads`** — used to trigger "Save As" dialog when saving images
- **`<all_urls>`** — content script needs to run on any page to detect images

No data is collected, no network requests are made by the extension itself.

## Limitations

- **Closed Shadow DOM**: Sites using closed shadow roots (rare) can't have their inner images detected — `elementsFromPoint` returns the shadow host, not internal elements.
- **CORS**: Copy-to-clipboard may fail for cross-origin images without CORS headers. The image still displays fine in the overlay; only programmatic pixel access is blocked.
- **Canvas-rendered images**: Images drawn on `<canvas>` elements aren't detected (would require canvas pixel capture, which is CORS-gated).

## License

MIT
