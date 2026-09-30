const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    locale: "fa-IR",
    viewport: { width: 1440, height: 900 }
  });

  try {
    const url = "https://divar.ir/s/tehran/buy-residential";

    console.log("Opening:", url);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(7000);

    // کمی اسکرول برای بارگذاری آگهی‌های بیشتر
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(3000);

    const listings = await page.locator('article').evaluateAll(articles =>
      articles.map(article => {
        const text = (article.innerText || "")
          .replace(/\n+/g, "\n")
          .trim();

        const link = article.querySelector('a[href*="/v/"]');

        return {
          title: text.split("\n")[0] || null,
          url: link ? link.href : null,
          text
        };
      })
      .filter(x => x.url)
    );

    console.log("Listings found:", listings.length);

    fs.mkdirSync("data", { recursive: true });

    fs.writeFileSync(
      "data/divar-raw.json",
      JSON.stringify(
        {
          source: "divar",
          city: "tehran",
          category: "buy-residential",
          collectedAt: new Date().toISOString(),
          listings
        },
        null,
        2
      ),
      "utf8"
    );

    console.log("Saved: data/divar-raw.json");

    console.log("\n========== SAMPLE ==========\n");

    console.log(
      JSON.stringify(listings.slice(0, 10), null, 2)
    );

  } catch (error) {
    console.error("SCRAPER FAILED:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
