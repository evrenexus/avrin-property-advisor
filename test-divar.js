const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    locale: "fa-IR",
    viewport: { width: 1440, height: 900 }
  });

  try {
    const url =
      "https://divar.ir/v/%D8%A7%D9%BE%D8%A7%D8%B1%D8%AA%D9%85%D8%A7%D9%86-%DB%B5%DB%B8-%D9%85%D8%AA%D8%B1%DB%8C-%D8%AE%D9%88%D8%B4-%D9%86%D9%82%D8%B4%D9%87-%D8%A8%D8%AF%D9%88%D9%86-%D9%85%D8%B4%D8%A7%D8%A8%D9%87/ga8acPuI";

    console.log("Opening:", url);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(4000);

    const text = await page.locator("body").innerText();

    console.log("\n========== DETAIL PAGE ==========\n");
    console.log(text);

  } catch (error) {
    console.error("FAILED:", error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
