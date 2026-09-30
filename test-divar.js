const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    locale: "fa-IR",
    viewport: { width: 1440, height: 900 }
  });

  try {
    const url = "https://divar.ir/s/tehran/real-estate";

    console.log("Opening:", url);

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    console.log("HTTP status:", response?.status());
    console.log("Final URL:", page.url());

    const articles = page.locator("article");
    const count = await articles.count();

    console.log("ARTICLE COUNT:", count);

    for (let i = 0; i < Math.min(count, 3); i++) {
      const article = articles.nth(i);

      const title = await article.locator("h2, h3").first()
        .innerText()
        .catch(() => "");

      const href = await article.locator("a").first()
        .getAttribute("href")
        .catch(() => null);

      const text = await article.innerText().catch(() => "");

      console.log(`\n========== ARTICLE ${i + 1} ==========`);
      console.log("TITLE:", title);
      console.log("LINK:", href);
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
