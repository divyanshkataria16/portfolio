# Divyansh Kataria — Portfolio

Personal portfolio of **Divyansh Kataria** — AI Marketing Consultant and Founder of Sparqera.

Live site: _(add your domain here once it's connected)_

## About

A single-page portfolio covering services, background, experience, client work,
and the AI products I've built — including **OLISSO**, an AI Growth Intelligence
platform for Instagram.

## Built with

No framework, no build step — plain HTML, CSS and JavaScript, so it deploys
anywhere as a static site.

- **GSAP + ScrollTrigger** — scroll choreography
- **Lenis** — smooth scrolling
- **WebGL** — a custom raymarched volumetric field behind the hero, written in
  GLSL with no 3D library. It renders at a fraction of device resolution and
  halts entirely once scrolled past the hero, so it costs nothing for most of
  the page.
- **Google Fonts** — Archivo Black, Instrument Serif, Space Grotesk

## Structure

```
index.html     markup
styles.css     design tokens + all component styles
script.js      animation engine, WebGL shader, interactions
assets/        images
```

## Running locally

No dependencies to install. Serve the folder over HTTP:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

Opening `index.html` directly via `file://` also works, but a local server is
closer to production.

## Performance notes

Animation is transform/opacity only, so everything composites on the GPU. The
frame loop performs no layout reads — measurements are cached and refreshed on
resize — and scroll reveals retire their own triggers once they have run.

## Contact

- Email — anshkataria525@gmail.com
- Website — sparqera.com
- LinkedIn — [divyansh-kataria](https://linkedin.com/in/divyansh-kataria-9316341b9)
