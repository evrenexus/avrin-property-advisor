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

// --------------------------------------------------
// استخراج مشخصات ساختاری
// --------------------------------------------------

function extractArea(lines) {
  const i = lines.indexOf("متراژ");

  if (i >= 0) {
    for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
      const n = toNumber(lines[j]);

      if (n >= 15 && n <= 5000) {
        return n;
      }
    }
  }

  return null;
}

function extractBuildYear(lines) {
  const i = lines.indexOf("ساخت");

  if (i >= 0) {
    for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
      const n = toNumber(lines[j]);

      if (n >= 1200 && n <= 1500) {
        return n;
      }
    }
  }

  return null;
}

function extractRooms(lines) {
  const i = lines.indexOf("اتاق");

  if (i >= 0) {
    for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
      const value = clean(lines[j]);

      if (value === "بدون اتاق") {
        return 0;
      }

      const n = toNumber(value);

      if (n !== null && n >= 0 && n <= 20) {
        return n;
      }
    }
  }

  return null;
}

function extractPrice(lines) {
  const i = lines.indexOf("قیمت کل");

  if (i >= 0) {
    for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
      const value = clean(lines[j]);

      const n = toNumber(value);

      if (n && n >= 1000000) {
        return n;
      }
    }
  }

  return null;
}

function extractPricePerMeter(lines) {
  const i = lines.indexOf("قیمت هر متر");

  if (i >= 0) {
    for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
      const n = toNumber(lines[j]);

      if (n && n >= 100000) {
        return n;
      }
    }
  }

  return null;
}

function extractFloor(lines) {
  const i = lines.indexOf("طبقه");

  if (i >= 0) {
    for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
      const value = clean(lines[j]);

      if (value) {
        return value;
      }
    }
  }

  return null;
}

// --------------------------------------------------
// موقعیت
// --------------------------------------------------

function extractLocation(lines) {
  for (const line of lines) {
    const text = clean(line);

    if (text.includes(" در تهران،")) {
      const parts = text.split(" در تهران،");

      const locationText = parts[1]
        ? parts[1].split("،")[0].trim()
        : null;

      return {
        city: "تهران",
        neighborhood: locationText || null
      };
    }
  }

  return {
    city: "تهران",
    neighborhood: null
  };
}

// --------------------------------------------------
// تاریخ / سن آگهی
// --------------------------------------------------

function extractPublishedText(lines) {
  for (const line of lines) {
    const text = clean(line);

    if (
      text.includes("دقایقی پیش") ||
      text.includes("ساعتی پیش") ||
      text.includes("ساعت پیش") ||
      text.includes("روزی پیش") ||
      text.includes("روز پیش") ||
      text.includes("هفته پیش") ||
      text.includes("ماه پیش")
    ) {
      return text;
    }
  }

  return null;
}

function ageInDays(publishedText) {
  if (!publishedText) return null;

  const text = clean(publishedText);

  if (
    text.includes("دقایقی پیش") ||
    text.includes("ساعتی پیش") ||
    text.includes("ساعت پیش")
  ) {
    return 0;
  }

  if (text.includes("روزی پیش")) {
    return 1;
  }

  let match = text.match(/(\d+)\s*روز پیش/);

  if (match) {
    return Number(match[1]);
  }

  match = text.match(/(\d+)\s*هفته پیش/);

  if (match) {
    return Number(match[1]) * 7;
  }

  match = text.match(/(\d+)\s*ماه پیش/);

  if (match) {
    return Number(match[1]) * 30;
  }

  return null;
}

// --------------------------------------------------
// ساخت عنوان خودمان
// --------------------------------------------------

function buildDisplayTitle({
  propertyType,
  area,
  rooms,
  neighborhood,
  city,
  price
}) {
  const parts = [];

  parts.push(propertyType || "ملک");

  if (area) {
    parts.push(
      `${area.toLocaleString("fa-IR")} مترمربعی`
    );
  }

  if (rooms !== null && rooms !== undefined) {
    if (rooms === 0) {
      parts.push("بدون اتاق");
    } else {
      parts.push(
        `${rooms.toLocaleString("fa-IR")} خوابه`
      );
    }
  }

  let title = parts.join(" ");

  const location =
    neighborhood && city
      ? `${neighborhood} / ${city}`
      : city || neighborhood;

  if (location) {
    title += `، ${location}`;
  }

  if (price) {
    const billion = price / 1000000000;

    const priceText = Number.isInteger(billion)
      ? `${billion.toLocaleString("fa-IR")} میلیارد تومان`
      : `${billion.toLocaleString("fa-IR", {
          maximumFractionDigits: 2
        })} میلیارد تومان`;

    title += ` — ${priceText}`;
  }

  return title;
}

// --------------------------------------------------
// لینک‌های آگهی
// --------------------------------------------------

async function getListingLinks(page) {
  return await page.locator('a[href*="/v/"]').evaluateAll(links => {
    const seen = new Set();
    const result = [];

    for (const a of links) {
      const href = a.href;

      if (!href || seen.has(href)) {
        continue;
      }

      seen.add(href);

      result.push({
        url: href
      });
    }

    return result;
  });
}

// --------------------------------------------------
// خواندن صفحه آگهی
// --------------------------------------------------

async function readListing(page, url) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(2500);

  const rawText = await page.locator("body").innerText();

  const lines = rawText
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

  const publishedText =
    extractPublishedText(lines);

  const ageDays =
    ageInDays(publishedText);

  // ------------------------------------------------
  // گزارش تشخیصی
  // ------------------------------------------------

  console.log("");
  console.log("----- STRUCTURED DATA -----");
  console.log("AREA:", area);
  console.log("BUILD YEAR:", buildYear);
  console.log("ROOMS:", rooms);
  console.log("PRICE:", price);
  console.log("PRICE/METER:", pricePerMeter);
  console.log("FLOOR:", floor);
  console.log("CITY:", location.city);
  console.log("NEIGHBORHOOD:", location.neighborhood);
  console.log("PUBLISHED:", publishedText);
  console.log("AGE DAYS:", ageDays);
  console.log("---------------------------");

  // ------------------------------------------------
  // فعلاً هیچ آگهی‌ای به خاطر ناقص بودن داده حذف نمی‌شود
  // ------------------------------------------------

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
    ageDays,

    source: "divar",
    url,

    // عنوان دیوار عمداً استفاده نمی‌شود
    originalTitle: null,

    // متن آگهی فعلاً استفاده نمی‌شود
    descriptionUsed: false
  };

  return listing;
}

// --------------------------------------------------
// MAIN
// --------------------------------------------------

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

    const links =
      await getListingLinks(page);

    console.log(
      "LISTING LINKS:",
      links.length
    );

    const listings = [];

    for (const item of links.slice(0, 20)) {
      console.log("");
      console.log(
        "Reading:",
        item.url
      );

      try {
        const listing =
          await readListing(
            page,
            item.url
          );

        listings.push(listing);

        console.log(
          "GENERATED TITLE:",
          listing.displayTitle
        );

      } catch (error) {
        console.log(
          "ERROR:",
          error.message
        );
      }
    }

    fs.mkdirSync(
      "data",
      { recursive: true }
    );

    fs.writeFileSync(
      "data/listings.json",
      JSON.stringify(
        listings,
        null,
        2
      ),
      "utf8"
    );

    console.log("");
    console.log(
      "========== FINAL LISTINGS =========="
    );

    console.log(
      "Count:",
      listings.length
    );

    console.log(
      JSON.stringify(
        listings,
        null,
        2
      )
    );

    console.log("");
    console.log(
      "Saved: data/listings.json"
    );

  } catch (error) {
    console.error(
      "TEST FAILED:"
    );

    console.error(error);

    process.exitCode = 1;

  } finally {
    await browser.close();
  }
})();
