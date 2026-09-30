const { chromium } = require("playwright");
const fs = require("fs");

const SOURCE_URL = "https://divar.ir/s/tehran/buy-residential";

function normalizeDigits(value = "") {
  return value
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

function clean(value = "") {
  return normalizeDigits(value)
    .replace(/\u200c/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value) {
  if (!value) return null;

  const n = normalizeDigits(value)
    .replace(/[,\s٬]/g, "")
    .replace(/[^\d]/g, "");

  return n ? Number(n) : null;
}

function extractArea(lines) {
  const i = lines.indexOf("متراژ");
  if (i >= 0 && lines[i + 1]) {
    const n = toNumber(lines[i + 1]);
    if (n >= 15 && n <= 5000) return n;
  }
  return null;
}

function extractBuildYear(lines) {
  const i = lines.indexOf("ساخت");
  if (i >= 0 && lines[i + 1]) {
    const n = toNumber(lines[i + 1]);

    // سال شمسی ساخت ملک
    if (n >= 1200 && n <= 1500) return n;
  }
  return null;
}

function extractRooms(lines) {
  const i = lines.indexOf("اتاق");
  if (i >= 0 && lines[i + 1]) {
    const value = clean(lines[i + 1]);

    if (value === "بدون اتاق") return 0;

    const n = toNumber(value);
    if (n !== null && n >= 0 && n <= 20) return n;
  }
  return null;
}

function extractPrice(lines) {
  const i = lines.indexOf("قیمت کل");

  if (i >= 0 && lines[i + 1]) {
    const value = clean(lines[i + 1]);
    const n = toNumber(value);

    if (n && n > 0) return n;
  }

  return null;
}

function extractPricePerMeter(lines) {
  const i = lines.indexOf("قیمت هر متر");

  if (i >= 0 && lines[i + 1]) {
    const value = clean(lines[i + 1]);
    const n = toNumber(value);

    if (n && n > 0) return n;
  }

  return null;
}

function extractFloor(lines) {
  const i = lines.indexOf("طبقه");

  if (i >= 0 && lines[i + 1]) {
    return clean(lines[i + 1]);
  }

  return null;
}

function extractLocation(lines) {
  // نمونه:
  // دقایقی پیش در تهران، امام زاده حسن، خ لقمان حکیم

  for (const line of lines) {
    const text = clean(line);

    if (text.includes(" در تهران،")) {
      const parts = text.split(" در تهران،");

      return {
        city: "تهران",
        neighborhood: parts[1] ? parts[1].split("،")[0].trim() : null
      };
    }
  }

  return {
    city: "تهران",
    neighborhood: null
  };
}

function extractPublishedAge(lines) {
  for (const line of lines) {
    const text = clean(line);

    if (
      text.includes("دقایقی پیش") ||
      text.includes("ساعتی پیش") ||
      text.includes("ساعت پیش") ||
      text.includes("روزی پیش") ||
      text.includes("روز پیش") ||
      text.includes("هفته پیش")
    ) {
      return text;
    }
  }

  return null;
}

function ageInDays(publishedText) {
  if (!publishedText) return null;

  const text = clean(publishedText);

  if (text.includes("دقایقی پیش")) return 0;
  if (text.includes("ساعتی پیش")) return 0;
  if (text.includes("ساعت پیش")) return 0;
  if (text.includes("روزی پیش")) return 1;

  let m = text.match(/(\d+)\s*روز پیش/);
  if (m) return Number(m[1]);

  m = text.match(/(\d+)\s*هفته پیش/);
  if (m) return Number(m[1]) * 7;

  return null;
}

function buildDisplayTitle({ propertyType, area, rooms, neighborhood, city, price }) {
  const parts = [];

  parts.push(propertyType || "ملک");

  if (area) {
    parts.push(`${area.toLocaleString("fa-IR")} مترمربعی`);
  }

  if (rooms !== null && rooms !== undefined) {
    if (rooms === 0) {
      parts.push("بدون اتاق");
    } else {
      parts.push(`${rooms.toLocaleString("fa-IR")} خوابه`);
    }
  }

  const location =
    neighborhood && city
      ? `${neighborhood} / ${city}`
      : city || neighborhood || null;

  let title = parts.join(" ");

  if (location) {
    title += `، ${location}`;
  }

  if (price) {
    const billion = price / 1000000000;

    let priceText;

    if (Number.isInteger(billion)) {
      priceText = `${billion.toLocaleString("fa-IR")} میلیارد تومان`;
    } else {
      priceText = `${billion.toLocaleString("fa-IR", {
        maximumFractionDigits: 2
      })} میلیارد تومان`;
    }

    title += ` — ${priceText}`;
  }

  return title;
}

async function getListingLinks(page) {
  return await page.locator('a[href*="/v/"]').evaluateAll(links => {
    const seen = new Set();
    const result = [];

    for (const a of links) {
      const href = a.href;

      if (!href || seen.has(href)) continue;

      seen.add(href);

      result.push({
        url: href,
        originalTitle: (a.innerText || "").trim()
      });
    }

    return result;
  });
}

async function readListing(page, url) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(2500);

  const lines = (await page.locator("body").innerText())
    .split("\n")
    .map(clean)
    .filter(Boolean);

  const area = extractArea(lines);
  const buildYear = extractBuildYear(lines);
  const rooms = extractRooms(lines);
  const price = extractPrice(lines);
  const pricePerMeter = extractPricePerMeter(lines);
  const floor = extractFloor(lines);
  const location = extractLocation(lines);
  const publishedText = extractPublishedAge(lines);

  const daysOld = ageInDays(publishedText);

  // آگهی‌های قدیمی‌تر از 28 روز حذف شوند.
  if (daysOld !== null && daysOld > 28) {
    return null;
  }

  // اگر مشخصات اصلی صفحه قابل استخراج نباشد، آگهی ناقص را فعلاً نگه نمی‌داریم.
  if (!area || !price) {
    return null;
  }

  const propertyType = "آپارتمان";

  const listing = {
    displayTitle: buildDisplayTitle({
      propertyType,
      area,
      rooms,
      neighborhood: location.neighborhood,
      city: location.city,
      price
    }),

    propertyType,
    dealType: "buy",

    area,
    rooms,
    buildYear,
    floor,

    price,
    pricePerMeter,

    city: location.city,
    neighborhood: location.neighborhood,

    publishedText,
    ageDays: daysOld,

    source: "divar",
    url,

    // عنوان اصلی دیوار فقط برای مرجع نگهداری می‌شود
    originalTitle: null,

    // فعلاً متن آگهی عمداً استفاده نمی‌شود
    descriptionUsed: false
  };

  return listing;
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    locale: "fa-IR",
    viewport: {
      width: 1440,
      height: 900
    }
  });

  try {
    console.log("Opening:", SOURCE_URL);

    await page.goto(SOURCE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(7000);

    const links = await getListingLinks(page);

    console.log("LISTING LINKS:", links.length);

    const listings = [];

    for (const item of links.slice(0, 20)) {
      console.log("Reading:", item.url);

      try {
        const listing = await readListing(page, item.url);

        if (!listing) {
          console.log("SKIP");
          continue;
        }

        listings.push(listing);

        console.log("OK:", listing.displayTitle);
      } catch (error) {
        console.log("ERROR:", error.message);
      }
    }

    fs.mkdirSync("data", { recursive: true });

    fs.writeFileSync(
      "data/listings.json",
      JSON.stringify(listings, null, 2),
      "utf8"
    );

    console.log("\n========== FINAL LISTINGS ==========");
    console.log("Count:", listings.length);
    console.log(JSON.stringify(listings, null, 2));

    console.log("\nSaved: data/listings.json");
  } catch (error) {
    console.error("TEST FAILED:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
