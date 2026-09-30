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

    console.log(`ARTICLE COUNT: ${count}`);

    for (let i = 0; i < count; i++) {
      const article = articles.nth(i);

      console.log(`\n========== ARTICLE ${i + 1} ==========`);

      console.log(
        "TEXT:",
        await article.innerText().catch(() => "")
      );

      const links = await article.locator("a").evaluateAll(els =>
        els.map(a => ({
          text: (a.innerText || "").trim(),
          href: a.href
        }))
      );

      console.log("LINKS:", JSON.stringify(links, null, 2));
    }

  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
