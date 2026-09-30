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

    // تمام پاسخ‌های شبکه را بررسی می‌کنیم
    page.on("response", async (response) => {
      const responseUrl = response.url();

      if (
        responseUrl.includes("api") ||
        responseUrl.includes("city") ||
        responseUrl.includes("location") ||
        responseUrl.includes("search")
      ) {
        console.log("\nNETWORK:");
        console.log(responseUrl);
      }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(8000);

    console.log("\n========== PAGE LOADED ==========");
    console.log("FINAL URL:", page.url());

    // لینک‌های مربوط به شهر
    const cityLinks = await page.locator('a[href^="/s/"]').evaluateAll(links =>
      links.map(a => ({
        text: (a.innerText || "").trim(),
        href: a.getAttribute("href")
      }))
    );

    console.log("\n========== SEARCH LINKS ==========");
    console.log(JSON.stringify(cityLinks, null, 2));

    // متن صفحه
    const bodyText = await page.locator("body").innerText();

    console.log("\n========== PAGE TEXT ==========");
    console.log(bodyText.slice(0, 10000));

  } catch (error) {
    console.error("TEST FAILED:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
