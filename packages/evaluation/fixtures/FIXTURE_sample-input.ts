// FIXTURE: synthetic demo deliverable. The ONLY content ever sent to a real model in M3 runs.
// Ground truth: c3 genuinely FAILS (the Desk Lamp <img> has no alt). c1, c2, c4 are satisfied.
import { createHash } from "node:crypto";

export const FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lumen Goods</title>
  <style>
    body { font-family: sans-serif; margin: 0; }
    .hero { padding: 64px 24px; background: #f4efe6; text-align: center; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 24px; }
    @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <section class="hero">
    <h1>Lumen Goods: calm things for your desk</h1>
    <p>Small-batch homewares, shipped worldwide.</p>
    <a class="cta" href="#shop">Shop the collection</a>
  </section>
  <main id="shop" class="grid">
    <article><img src="mug.jpg" alt="Speckled ceramic mug"><h2>Ceramic Mug</h2><p class="price">$18</p></article>
    <article><img src="notebook.jpg" alt="Linen-bound notebook"><h2>Linen Notebook</h2><p class="price">$12</p></article>
    <article><img src="lamp.jpg"><h2>Desk Lamp</h2><p class="price">$54</p></article>
    <article><img src="tray.jpg" alt="Walnut desk tray"><h2>Walnut Tray</h2><p class="price">$29</p></article>
  </main>
</body>
</html>
`;

export const FIXTURE_CRITERIA_VERSION = "FIXTURE-v1";
export const FIXTURE_CRITERIA = [
  { id: "c1", text: "The page has a hero section with a clear call-to-action link or button." },
  { id: "c2", text: "The page is responsive: it has a viewport meta tag and at least one CSS media query." },
  { id: "c3", text: "Every <img> element has a non-empty alt attribute." },
  { id: "c4", text: "A product grid shows at least 3 products, each with a name and a price." },
];

export const FIXTURE_SUBMISSION_HASH = createHash("sha256").update(Buffer.from(FIXTURE_HTML, "utf8")).digest("hex");

export function buildFixtureInput(aiConsentGiven = true) {
  return {
    criteriaVersion: FIXTURE_CRITERIA_VERSION,
    criteria: FIXTURE_CRITERIA.map((c) => ({ ...c })),
    submission: {
      kind: "static_project" as const,
      name: "FIXTURE_lumen-goods",
      files: [{ path: "index.html", content: FIXTURE_HTML }],
    },
    submissionHash: FIXTURE_SUBMISSION_HASH,
    aiConsentGiven,
  };
}
