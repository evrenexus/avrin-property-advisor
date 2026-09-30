const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    locale: "fa-IR",
    viewport: { width: 1440, height: 900 }
  });

  try {
    // صفحه عمومی املاک دیوار
    const url = "https://divar.ir/s/real-estate";

    console.log("Opening:", url);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    console.log("HTTP status: loaded");
    console.log("FINAL URL:", page.url());

    const articles = page.locator("article");
    const count = await articles.count();

    console.log("ARTICLE COUNT:", count);

    const results = [];

    for (let i = 0; i < Math.min(count, 10); i++) {
      const article = articles.nth(i);

      const title = await article.locator("h2, h3").first()
        .innerText()
        .catch(() => "");

      const href = await article.locator("a").first()
        .getAttribute("href")
        .catch(() => null);

      const cardText = await article.innerText().catch(() => "");

      results.push({
        title,
        url: href ? new URL(href, "https://divar.ir").href : null,
        cardText
      });

      console.log(`\n========== ARTICLE ${i + 1} ==========`);
      console.log("TITLE:", title);
      console.log("LINK:", href);
      console.log("CARD TEXT:");
      console.log(cardText);
    }

    const report = [
      "# Divar Iran Test",
      "",
      `Final URL: ${page.url()}`,
      `Article count: ${count}`,
      "",
      ...results.map((item, index) => `
## Article ${index + 1}

**Title:** ${item.title}

**URL:** ${item.url}

**Card text:**

\`\`\`
${item.cardText}
\`\`\`
`).join("\n")
    ];

    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        report.join("\n")
      );
    }

  } catch (error) {
    console.error("TEST FAILED:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
