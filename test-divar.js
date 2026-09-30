const { chromium } = require("playwright");
const fs = require("fs");

const SOURCE_URL = "https://divar.ir/s/tehran/buy-residential";

function cleanNumber(text) {
  if (!text) return null;

  const digits = text
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[^\d]/g, "");

  return digits ? Number(digits) : null;
}

function isAgency(text) {
  if (!text) return false;

  const agencyWords = [
    "آژانس املاک",
    "املاک ",
    "دفتر املاک",
    "مشاور املاک",
    "دپارتمان املاک",
    "بنگاه املاک"
  ];

  return agencyWords.some(word => text.includes(word));
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    locale: "fa-IR",
    viewport: { width: 1440, height: 900 }
  });

  try {
    console.log("Opening:", SOURCE_URL);

    await page.goto(SOURCE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    const cards = await page.locator("article").evaluateAll(articles =>
      articles.map(article => {
        const text = (article.innerText || "").trim();
        const link = article.querySelector('a[href*="/v/"]');

        return {
          text,
          url: link ? link.href : null
        };
      }).filter(x => x.url)
    );

    console.log("Cards:", cards.length);

    const listings = [];

    for (const card of cards) {
      console.log("\nReading:", card.url);

      // حذف آگهی‌های واضحاً مشاور/آژانس
      if (isAgency(card.text)) {
        console.log("SKIP AGENCY");
        continue;
      }

      const detail = await browser.newPage({
        locale: "fa-IR",
        viewport: { width: 1440, height: 900 }
      });

      try {
        await detail.goto(card.url, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });

        await detail.waitForTimeout(2500);

        const body = await detail.locator("body").innerText();

        const lines = body
          .split("\n")
          .map(x => x.trim())
          .filter(Boolean);

        const title = lines[0] || null;

        // قیمت کل
        const priceLine = lines.find(x =>
          x.includes("تومان") &&
          !x.includes("ودیعه") &&
          !x.includes("اجاره")
        );

        const price = cleanNumber(priceLine);

        // اطلاعات ساختاری احتمالی صفحه جزئیات
        const structured = {};

        for (let i = 0; i < lines.length - 1; i++) {
          const key = lines[i];
          const value = lines[i + 1];

          if (
            [
              "متراژ",
              "اتاق",
              "ساخت",
              "طبقه",
              "تعداد واحد",
              "پارکینگ",
              "انباری",
              "آسانسور"
            ].includes(key)
          ) {
            structured[key] = value;
          }
        }

        listings.push({
          source: "divar",
          city: "تهران",
          dealType: "buy",
          propertyType: "residential",
          title,
          price,
          url: card.url,
          structured,
          rawText: body
        });

        console.log("OK");

      } catch (err) {
        console.log("DETAIL ERROR:", err.message);
      } finally {
        await detail.close();
      }
    }

    fs.mkdirSync("data", { recursive: true });

    fs.writeFileSync(
      "data/listings.json",
      JSON.stringify(
        {
          source: "divar",
          collectedAt: new Date().toISOString(),
          count: listings.length,
          listings
        },
        null,
        2
      ),
      "utf8"
    );

    console.log("\n==============================");
    console.log("FINAL LISTINGS:", listings.length);
    console.log("Saved: data/listings.json");
    console.log("==============================");

  } catch (error) {
    console.error("COLLECTOR FAILED:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
