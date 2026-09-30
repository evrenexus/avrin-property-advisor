const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    locale: "fa-IR",
    viewport: { width: 1440, height: 900 }
  });

  try {
    const url = "https://divar.ir/s/tehran/real-estate";

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    const articles = page.locator("article");
    const count = await articles.count();

    console.log("ARTICLE COUNT:", count);

    for (let i = 0; i < Math.min(count, 3); i++) {
      const article = articles.nth(i);

      console.log(`\n========== ARTICLE ${i + 1} ==========`);

      const title = await article.locator("h2, h3").first()
        .innerText()
        .catch(() => "");

      const text = await article.innerText().catch(() => "");

      const link = await article.locator("a").first()
        .getAttribute("href")
        .catch(() => null);

      console.log("TITLE:", title);
      console.log("LINK:", link);
      console.log("FULL TEXT:");
      console.log(text);
    }

  } catch (error) {
    console.error("TEST FAILED:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
