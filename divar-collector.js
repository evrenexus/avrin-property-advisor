const { chromium } = require("playwright");
const fs = require("fs");

const MAX_AGE_HOURS = 336;
const MAX_LISTING_LINKS_PER_CITY = 50;
const CONCURRENCY_DELAY_MS = 300;
const DETAIL_CONCURRENCY = 6; // bounded concurrency for GitHub Actions

function normalizeDigits(value = "") {
  return String(value)
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

function firstNumberAfter(lines, label, validator) {
  const i = lines.indexOf(label);
  if (i < 0) return null;
  for (let j = i + 1; j <= i + 5 && j < lines.length; j++) {
    const n = toNumber(lines[j]);
    if (n !== null && validator(n, lines[j])) return n;
  }
  return null;
}

function extractArea(lines) {
  return firstNumberAfter(lines, "متراژ", n => n >= 15 && n <= 5000);
}

function extractBuildYear(lines) {
  return firstNumberAfter(lines, "ساخت", n => n >= 1200 && n <= 1500);
}

function extractRooms(lines) {
  const i = lines.indexOf("اتاق");
  if (i < 0) return null;
  for (let j = i + 1; j <= i + 5 && j < lines.length; j++) {
    const value = clean(lines[j]);
    if (value === "بدون اتاق") return 0;
    const n = toNumber(value);
    if (n !== null && n >= 0 && n <= 20 && /^\d+$/.test(value)) return n;
  }
  return null;
}

function extractPrice(lines) {
  const i = lines.indexOf("قیمت کل");
  if (i < 0) return null;
  for (let j = i + 1; j <= i + 5 && j < lines.length; j++) {
    const n = toNumber(lines[j]);
    if (n !== null && n >= 1000000) return n;
  }
  return null;
}

function extractPricePerMeter(lines) {
  const i = lines.indexOf("قیمت هر متر");
  if (i < 0) return null;
  for (let j = i + 1; j <= i + 5 && j < lines.length; j++) {
    const n = toNumber(lines[j]);
    if (n !== null && n >= 100000) return n;
  }
  return null;
}

function extractFloor(lines) {
  const i = lines.indexOf("طبقه");
  if (i < 0) return null;
  for (let j = i + 1; j <= i + 5 && j < lines.length; j++) {
    const value = clean(lines[j]);
    if (value && value.length <= 30) return value;
  }
  return null;
}

function extractUnits(lines) {
  const labels = ["تعداد واحد", "تعداد واحدها", "واحد"];
  for (const label of labels) {
    const i = lines.indexOf(label);
    if (i < 0) continue;
    for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
      const value = clean(lines[j]);
      const n = toNumber(value);
      if (n !== null && n >= 1 && n <= 500 && /^\d+$/.test(value)) return n;
    }
  }
  return null;
}

function extractLocation(lines) {
  for (const line of lines) {
    const text = clean(line);
    const match = text.match(/(?:دقایقی پیش|ساعتی پیش|\d+\s*(?:روز|هفته|ماه) پیش) در ([^،]+)/);
    if (match) {
      const cityAndMaybeArea = match[1].trim();
      const rest = text.split(" در ")[1] || "";
      const parts = rest.split("،").map(x => x.trim()).filter(Boolean);
      return {
        city: cityAndMaybeArea,
        neighborhood: parts.length > 1 ? parts[1] : null
      };
    }
    const generic = text.match(/ در ([^،]+)،\s*([^،]+)/);
    if (generic) {
      return { city: generic[1].trim(), neighborhood: generic[2].trim() };
    }
  }
  return { city: null, neighborhood: null };
}

function extractPublishedText(lines) {
  for (const line of lines) {
    const text = clean(line);
    if (
      /(?:دقایقی پیش|ساعتی پیش|روزی پیش|هفته پیش|ماه پیش)/.test(text) ||
      /\d+\s*(?:روز|هفته|ماه) پیش/.test(text)
    ) {
      return text;
    }
  }
  return null;
}

function ageHours(publishedText) {
  if (!publishedText) return null;
  const text = clean(publishedText);
  if (/دقایقی پیش/.test(text)) return 0;
  if (/ساعتی پیش/.test(text)) return 1;
  if (/روزی پیش/.test(text)) return 24;

  let m = text.match(/(\d+)\s*روز پیش/);
  if (m) return Number(m[1]) * 24;
  m = text.match(/(\d+)\s*هفته پیش/);
  if (m) return Number(m[1]) * 7 * 24;
  m = text.match(/(\d+)\s*ماه پیش/);
  if (m) return Number(m[1]) * 30 * 24;
  return null;
}

function detectSellerType(lines) {
  const text = lines.join(" ");
  if (/آژانس املاک|مشاور املاک|دفتر املاک|بنگاه املاک/.test(text)) return "agency";
  if (/مشاور شما/.test(text)) return "agency";
  return "personal";
}

function extractPropertyType(lines) {
  const stop = lines.findIndex(x => x === "توضیحات");
  const top = (stop >= 0 ? lines.slice(0, stop) : lines).join(" ");

  if (/زمین|کلنگی/.test(top)) return "زمین و کلنگی";
  if (/ویلا|خانه و ویلا/.test(top)) return "خانه و ویلا";
  if (/مغازه|تجاری|دفتر کار|صنعتی/.test(top)) return "املاک تجاری";
  if (/آپارتمان/.test(top)) return "آپارتمان";
  return "ملک مسکونی";
}

function detectVerified(lines) {
  return lines.some(x => /تأیید شده|تایید شده|احراز هویت شده/.test(x));
}

function buildDisplayTitle({ propertyType, area, rooms, neighborhood, city, price }) {
  const parts = [propertyType || "ملک"];
  if (area) parts.push(`${area.toLocaleString("fa-IR")} مترمربعی`);
  if (rooms !== null) parts.push(rooms === 0 ? "بدون اتاق" : `${rooms.toLocaleString("fa-IR")} خوابه`);
  let title = parts.join(" ");
  const location = neighborhood && city ? `${neighborhood} / ${city}` : city || neighborhood;
  if (location) title += `، ${location}`;
  if (price) {
    if (price < 1000000000) {
      title += ` — ${price.toLocaleString("fa-IR")} تومان`;
    } else {
      const b = price / 1000000000;
      title += ` — ${b.toLocaleString("fa-IR", { maximumFractionDigits: 2 })} میلیارد تومان`;
    }
  }
  return title;
}

async function getCities(page) {
  const cachePath = "data/cities.json";

  // Use the cached city list on subsequent runs.
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      if (Array.isArray(cached) && cached.length > 0) {
        console.log("Using cached city list:", cached.length);
        return cached;
      }
    } catch (e) {
      console.log("CITY CACHE ERROR:", e.message);
    }
  }

  const citiesBySlug = new Map();

  async function loadCities(url) {
    try {
      const response = await page.request.get(url, { timeout: 30000 });
      if (!response.ok()) {
        console.log("CITY API STATUS:", url, response.status());
        return;
      }

      const data = await response.json();
      const cities = Array.isArray(data) ? data : (data.cities || data.data || []);

      for (const city of cities) {
        if (!city || typeof city !== "object") continue;
        const slug = city.slug || city.city_slug || city.citySlug;
        const display = city.display || city.name || city.title || slug;
        if (
          typeof slug === "string" &&
          /^[a-z0-9-]{2,60}$/.test(slug)
        ) {
          citiesBySlug.set(slug, {
            slug,
            display: typeof display === "string" ? display : slug
          });
        }
      }
    } catch (e) {
      console.log("CITY API ERROR:", url, e.message);
    }
  }

  // Divar's city API provides the authoritative city list.
  // We use the unauthenticated endpoint that is already returning the full
  // Divar city set in this collector.
  await loadCities("https://api.divar.ir/v8/places/cities");

  // Official Open Platform endpoint is also attempted when available.
  await loadCities("https://open-api.divar.ir/v1/open-platform/assets/city");

  let cities = [...citiesBySlug.values()];

  if (!cities.length) {
    console.log("CITY API returned no cities; using Tehran fallback.");
    cities = [{ slug: "tehran", display: "تهران" }];
  }

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cities, null, 2), "utf8");
  console.log("Saved city list:", cities.length);

  return cities;
}
async function getListingLinks(page, city) {
  const url = `https://divar.ir/s/${city}/buy-residential`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  return await page.locator('a[href*="/v/"]').evaluateAll((links, limit) => {
    const seen = new Set();
    const result = [];
    for (const a of links) {
      const href = a.href;
      if (!href || seen.has(href)) continue;
      seen.add(href);
      result.push({ url: href });
      if (result.length >= limit) break;
    }
    return result;
  }, MAX_LISTING_LINKS_PER_CITY);
}

async function readListing(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(1000);
  const rawText = await page.locator("body").innerText();
  const lines = rawText.split("\n").map(clean).filter(Boolean);

  const area = extractArea(lines);
  const buildYear = extractBuildYear(lines);
  const rooms = extractRooms(lines);
  const price = extractPrice(lines);
  const pricePerMeter = extractPricePerMeter(lines);
  const floor = extractFloor(lines);
  const units = extractUnits(lines);
  const location = extractLocation(lines);
  const publishedText = extractPublishedText(lines);
  const age = ageHours(publishedText);

  // Title and description are not used for property specifications.
  const sellerType = detectSellerType(lines);
  if (sellerType === "agency") return null;

  // Only listings with a known publication age and age <= 14 days are accepted.
  if (age === null || age > MAX_AGE_HOURS) return null;

  const propertyType = extractPropertyType(lines);
  return {
    displayTitle: buildDisplayTitle({ propertyType, area, rooms, neighborhood: location.neighborhood, city: location.city, price }),
    propertyType,
    dealType: "buy",
    area,
    rooms,
    buildYear,
    floor,
    units,
    price,
    pricePerMeter,
    city: location.city,
    neighborhood: location.neighborhood,
    sellerType,
    verified: detectVerified(lines),
    publishedText,
    ageHours: age,
    ageStatus: age === null ? "unknown" : "known",
    source: "divar",
    url,
    originalTitle: null,
    descriptionUsed: false
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: "fa-IR", viewport: { width: 1440, height: 900 } });
  const all = [];
  const seen = new Set();

  try {
    console.log("Discovering Divar cities...");
    const cities = await getCities(page);
    console.log("CITY COUNT:", cities.length);

    for (const city of cities) {
      console.log("CITY:", city.slug);
      let links = [];
      try {
        links = await getListingLinks(page, city.slug);
      } catch (e) {
        console.log("CITY ERROR:", city, e.message);
        continue;
      }

      const queue = links.filter(item => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });

      // Read detail pages concurrently instead of opening them one-by-one.
      // This keeps the same structured-field extraction rules while cutting
      // collection time dramatically.
      for (let i = 0; i < queue.length; i += DETAIL_CONCURRENCY) {
        const batch = queue.slice(i, i + DETAIL_CONCURRENCY);
        const results = await Promise.all(
          batch.map(async item => {
            const detailPage = await browser.newPage({
              locale: "fa-IR",
              viewport: { width: 1440, height: 900 }
            });
            try {
              return await readListing(detailPage, item.url);
            } catch (e) {
              console.log("LISTING ERROR:", item.url, e.message);
              return null;
            } finally {
              await detailPage.close();
            }
          })
        );

        for (const listing of results) {
          if (listing) all.push(listing);
        }

        if (i + DETAIL_CONCURRENCY < queue.length) {
          await page.waitForTimeout(CONCURRENCY_DELAY_MS);
        }
      }
    }

    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync("data/listings.json", JSON.stringify(all, null, 2), "utf8");
    console.log("FINAL COUNT:", all.length);
  } finally {
    await browser.close();
  }
})();
