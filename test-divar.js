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

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    const links = await page.locator("a[href]").evaluateAll(links =>
      links.map(a => ({
        text: (a.innerText || "").trim(),
        href: a.getAttribute("href")
      }))
      .filter(x =>
        x.href &&
        x.href.startsWith("/s/")
      )
    );

    const unique = [];
    const seen = new Set();

    for (const item of links) {
      if (!seen.has(item.href)) {
        seen.add(item.href);
        unique.push(item);
      }
    }

    console.log("\n========== DIVAR SEARCH LINKS ==========");
    console.log("TOTAL:", unique.length);

    for (const item of unique) {
      console.log(`TEXT: ${item.text}`);
      console.log(`URL: ${item.href}`);
      console.log("--------------------------------");
    }

  } catch (error) {
    console.error("TEST FAILED:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
