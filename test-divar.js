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

    console.log("HTTP status:", response?.status());
    await page.waitForTimeout(5000);

    console.log("Page title:", await page.title());
    console.log("Final URL:", page.url());

    const cards = await page.locator("article").count();
    console.log("Article count:", cards);

    const text = (await page.locator("body").innerText()).slice(0, 5000);

    console.log("\n--- PAGE TEXT ---\n");
    console.log(text);

    await page.screenshot({
      path: "divar-test.png",
      fullPage: false
    });

    console.log("\nScreenshot saved: divar-test.png");

  } catch (error) {
    console.error("TEST FAILED:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
