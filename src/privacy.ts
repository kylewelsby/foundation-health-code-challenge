/** Privacy policy, served at GET /privacy. Reflects the no-persistence design (ADR / README). */
export const privacyHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Privacy Policy — MP3 Frame Analysis</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0; background: hsl(240 10% 3.9%); color: hsl(0 0% 98%);
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        line-height: 1.65;
      }
      main { max-width: 42rem; margin: 0 auto; padding: 4rem 1.5rem; }
      a { color: inherit; text-underline-offset: 2px; }
      a:hover { color: hsl(0 0% 100%); }
      h1 { font-size: 1.875rem; letter-spacing: -0.02em; margin: 0 0 0.25rem; }
      h2 { font-size: 1.05rem; margin: 2rem 0 0.5rem; }
      p, li { color: hsl(240 5% 78%); }
      .muted { color: hsl(240 5% 64.9%); font-size: 0.85rem; }
      .card {
        margin-top: 2rem; padding: 1.5rem; border: 1px solid hsl(240 3.7% 15.9%);
        border-radius: 0.75rem; background: hsl(240 10% 5.5%);
      }
      .back { font-size: 0.85rem; color: hsl(240 5% 64.9%); text-decoration: none; }
      footer { margin-top: 2.5rem; font-size: 0.8rem; color: hsl(240 5% 64.9%); }
    </style>
  </head>
  <body>
    <main>
      <a class="back" href="/">&larr; Back to the analyzer</a>
      <h1 style="margin-top:1.5rem">Privacy Policy</h1>
      <p class="muted">Last updated 18 June 2026</p>

      <div class="card">
        <p>
          MP3 Frame Analysis is a stateless tool that counts the audio frames in an MP3 you upload.
          It is designed to collect and retain as little as possible.
        </p>

        <h2>What we do with your file</h2>
        <p>
          Your uploaded file is sent to a Cloudflare Worker, parsed <strong>in memory</strong> to count
          its frames, and then <strong>discarded</strong>. It is never written to disk, stored in a
          database, logged, or shared with third parties. Nothing about the audio content is retained
          after the response is returned.
        </p>

        <h2>What we collect</h2>
        <p>
          No accounts, no cookies, no analytics, and no tracking. We do not collect personal
          information. Standard, transient network metadata (such as IP addresses) may be processed by
          Cloudflare to route and protect the request, per
          <a href="https://www.cloudflare.com/privacypolicy/" rel="noopener" target="_blank">Cloudflare's privacy policy</a>.
        </p>

        <h2>Your control</h2>
        <p>
          Because nothing is stored, there is nothing to access, export, or delete — closing the tab
          leaves no trace of your file on our side.
        </p>
      </div>

      <footer>
        Built by <a href="https://mekyle.com" rel="noopener" target="_blank">mekyle.com</a>.
      </footer>
    </main>
  </body>
</html>`;
