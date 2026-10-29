# Short Notes — Writing Spec

Audience: BTech 1st-year students of UIT, Barkatullah University, Bhopal. They read these notes
just before exams. The notes must be easy to follow, accurate, and exam-oriented.

## Output
- Write ONLY an HTML fragment (no `<html>`, `<head>`, `<body>`, no `<style>`) to `short-notes/src/<CODE>.html`.
- The build adds the title band, header/footer and the "CODE • Ajeet Soni" watermark on every page.
- Build: `node short-notes/build.mjs <CODE>` (run from the repo root
  `d:/Office stuff/Apptitude plateform/livebusite`). Output: `short-notes/pdf/<CODE> ... .pdf`.
- **Hard limit: the PDF must be 10 pages or fewer. Aim for 8–10 pages.** Each unit gets at most
  ~2 pages. If you go over, tighten wording (don't drop syllabus topics). If you are well under 8,
  add depth (derivations, solved examples, diagrams) where it helps exams most.

## Language: Hinglish
- Roman-script Hindi mixed with English, the way students talk: "Rolle's theorem kehta hai ki agar
  function continuous hai [a,b] par aur differentiable hai (a,b) mein, to kam se kam ek c exist karega jahan f'(c)=0."
- Keep ALL technical terms, definitions' key words, formulas, units, law names in English.
- Short sentences. No Devanagari script. No emojis.

## Coverage (most important)
- EVERY topic and sub-topic listed in the unit syllabus must appear as a heading or bullet with
  real explanation. Nothing from the syllabus may be skipped. Follow syllabus order.
- Per topic, as relevant: definition → key idea/working → formula/derivation sketch → diagram or
  table → short solved example/numerical (for numerical subjects) → exam tip.
- Be technically correct. Double-check every formula, value, and statement (research carefully;
  use standard textbook results — Grewal, Dass, Jain & Jain, Rajput, Boylestad, etc.).

## Allowed HTML building blocks (styles already exist in style.css)
```html
<div class="unit">
  <h2 class="unit-title"><span>UNIT I</span> Calculus</h2>
  <h3>1. Topic</h3>
  <h4>Sub-topic</h4>
  <p>…</p> <ul><li>…</li></ul> <ol>…</ol>
  <div class="box def"><span class="lbl">Definition</span> …</div>
  <div class="box formula"><span class="lbl">Formula</span><span class="eq">…</span></div>
  <div class="box tip"><span class="lbl">Exam Tip</span> …</div>
  <div class="box trick"><span class="lbl">Yaad Rakho</span> …</div>
  <div class="box warn"><span class="lbl">Common Mistake</span> …</div>
  <table><tr><th>…</th></tr><tr><td>…</td></tr></table>
  <div class="cols2"> …short items flow into 2 columns… </div>
  <div class="grid2"><div>…</div><div>…</div></div>
  <figure><svg viewBox="0 0 300 120" width="300">…</svg><figcaption>…</figcaption></figure>
  <pre>code</pre>
</div>
```
- Math: plain HTML + Unicode (∫ ∑ √ π θ λ ∂ ≤ ≥ ≠ → ∞ ± × ÷ ·), `<sup>`, `<sub>`,
  `<span class="m">` for inline math font, `<span class="eq">` for a centered display equation,
  fractions: `<span class="frac"><span>num</span><span>den</span></span>`.
- Use tables for comparisons/classifications (they save space). Use `cols2` for lists of short items.
- Simple inline SVG diagrams are welcome where a picture explains faster (circuits, P-V diagrams,
  beam SFD/BMD, block diagrams, projections). Keep them small (≤ ~140px tall), use stroke `#1c2230`,
  accent `#1f4e8c`, text font-size 10–11. Make sure SVGs actually render correctly.
- No external resources, no scripts, no images from the web.

## Verify before finishing
1. Run the build; confirm "OK" and page count ≤ 10.
2. Read the generated PDF (Read tool on the .pdf) and look at each page: nothing broken,
   no overflowing tables/SVGs, no blank half-pages, math legible.
3. Cross-check the syllabus list against your headings — every topic present.
