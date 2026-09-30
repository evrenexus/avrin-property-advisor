const fs = require("fs");

const MAX_AGE_HOURS = 336;
const MAX_LISTING_LINKS_PER_CITY = 50;
const CONCURRENCY_DELAY_MS = 300;
const DETAIL_CONCURRENCY = 10; // bounded concurrency for GitHub Actions

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


async function getCities() {
  const cachePath = "data/cities.json";

  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      if (
        Array.isArray(cached) &&
        cached.length > 0 &&
        cached.every(city => city && city.slug && city.id != null)
      ) {
        console.log("Using cached city list:", cached.length);
        return cached;
      }
      console.log("City cache is missing Divar IDs; refreshing.");
    } catch (e) {
      console.log("CITY CACHE ERROR:", e.message);
    }
  }

  const citiesBySlug = new Map();

  async function loadCities(url) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      if (!response.ok) {
        console.log("CITY API STATUS:", url, response.status);
        return;
      }

      const data = await response.json();
      const cities = Array.isArray(data) ? data : (data.cities || data.data || []);

      for (const city of cities) {
        if (!city || typeof city !== "object") continue;
        const slug = city.slug || city.city_slug || city.citySlug;
        const display = city.display || city.name || city.title || slug;
        const id = city.id ?? city.city_id ?? city.cityId;

        if (
          typeof slug === "string" &&
          /^[a-z0-9-]{2,60}$/.test(slug) &&
          id != null
        ) {
          citiesBySlug.set(slug, {
            id,
            slug,
            display: typeof display === "string" ? display : slug
          });
        }
      }
    } catch (e) {
      console.log("CITY API ERROR:", url, e.message);
    }
  }

  await loadCities("https://api.divar.ir/v8/places/cities");

  const cities = [...citiesBySlug.values()];
  if (!cities.length) {
    throw new Error("Divar city API returned no usable cities.");
  }

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cities, null, 2), "utf8");
  console.log("Saved city list:", cities.length);

  return cities;
}

async function getListingLinks(city) {
  if (!city || city.id == null) {
    throw new Error("City ID is missing for " + (city?.slug || "unknown city"));
  }

  const categories = ["apartment-sell", "house-villa-sell"];
  const seen = new Set();
  const result = [];

  for (const category of categories) {
    let paginationData = null;
    let pageCount = 0;

    while (result.length < MAX_LISTING_LINKS_PER_CITY && pageCount < 20) {
      const body = {
        city_ids: [String(city.id)],
        search_data: {
          form_data: {
            data: {
              category: { str: { value: category } }
            }
          }
        }
      };

      if (paginationData) body.pagination_data = paginationData;

      const response = await fetch(
        "https://api.divar.ir/v8/postlist/w/search",
        {
          method: "POST",
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );

      if (!response.ok) {
        throw new Error(
          "Divar list API " + response.status + " for " + city.slug
        );
      }

      const data = await response.json();
      const widgets = Array.isArray(data.list_widgets) ? data.list_widgets : [];

      for (const widget of widgets) {
        if (widget.widget_type !== "POST_ROW") continue;

        const payload = widget?.data?.action?.payload || {};
        const token = payload.token;
        if (!token || seen.has(token)) continue;

        seen.add(token);
        result.push({
          url: "https://divar.ir/v/" + token,
          token,
          category,
          title: payload?.web_info?.title || "",
          neighborhood: payload?.web_info?.district_persian || "",
          city: payload?.web_info?.city_persian || city.display || "",
          publishedAt: widget.sort_date || null
        });

        if (result.length >= MAX_LISTING_LINKS_PER_CITY) break;
      }

      const pagination = data.pagination || {};
      if (!pagination.has_next_page || !pagination.data) break;

      paginationData = pagination.data;
      pageCount++;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  console.log("LIST API:", city.slug, "=>", result.length, "listing links");
  return result;
}

function collectWidgetObjects(detail) {
  const widgets = [];
  if (detail && Array.isArray(detail.sections)) {
    for (const section of detail.sections) {
      if (Array.isArray(section?.widgets)) widgets.push(...section.widgets);
    }
  }

  function findModal(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (
      obj.modal_page &&
      obj.modal_page.title === "ویژگی‌ها و امکانات" &&
      Array.isArray(obj.modal_page.widget_list)
    ) {
      return obj.modal_page.widget_list;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findModal(item);
        if (found) return found;
      }
    } else {
      for (const value of Object.values(obj)) {
        const found = findModal(value);
        if (found) return found;
      }
    }
    return null;
  }

  const modal = findModal(detail);
  if (modal) widgets.push(...modal);
  return widgets;
}

function extractStructuredLines(detail) {
  const lines = [];

  for (const widget of collectWidgetObjects(detail)) {
    const wt = widget?.widget_type;
    const data = widget?.data || {};

    if (wt === "GROUP_INFO_ROW") {
      for (const item of data.items || []) {
        if (item?.title) lines.push(clean(item.title));
        if (item?.value != null) lines.push(clean(item.value));
      }
    } else if (wt === "UNEXPANDABLE_ROW") {
      if (data.title) lines.push(clean(data.title));
      if (data.value != null) lines.push(clean(data.value));
    } else if (wt === "FEATURE_ROW") {
      if (data.title) lines.push(clean(data.title));
    } else if (wt === "GROUP_FEATURE_ROW") {
      for (const item of data.items || []) {
        if (item?.title) lines.push(clean(item.title));
      }
    } else if (wt === "DESCRIPTION_ROW") {
      if (data.text) lines.push(clean(data.text));
    }
  }

  return lines.filter(Boolean);
}

function collectAllText(detail) {
  const out = [];

  function walk(value) {
    if (typeof value === "string") {
      const s = clean(value);
      if (s) out.push(s);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) walk(item);
    }
  }

  walk(detail);
  return out;
}

async function readListing(item) {
  const response = await fetch(
    "https://api.divar.ir/v8/posts-v2/web/" + encodeURIComponent(item.token),
    { headers: { "User-Agent": "Mozilla/5.0" } }
  );

  if (!response.ok) {
    throw new Error("Divar detail API " + response.status());
  }

  const detail = await response.json();
  const lines = extractStructuredLines(detail);

  const area = extractArea(lines);
  const buildYear = extractBuildYear(lines);
  const rooms = extractRooms(lines);
  const price = extractPrice(lines);
  const pricePerMeter = extractPricePerMeter(lines);
  const floor = extractFloor(lines);
  const units = extractUnits(lines);

  const publishedAt = item.publishedAt ? new Date(item.publishedAt) : null;
  const age = publishedAt && !Number.isNaN(publishedAt.getTime())
    ? Math.max(0, (Date.now() - publishedAt.getTime()) / 3600000)
    : null;

  // The publication timestamp comes from Divar's list API, not from title text.
  // This is the authoritative age check used by this collector.
  if (age === null || age > MAX_AGE_HOURS) return null;

  const location = {
    city: item.city || null,
    neighborhood: item.neighborhood || null
  };

  const allText = collectAllText(detail);
  const sellerText = allText.slice(0, 250).join(" ");
  const sellerType =
    /آژانس املاک|مشاور املاک|دفتر املاک|بنگاه املاک|مشاور شما/.test(sellerText)
      ? "agency"
      : "personal";

  if (sellerType === "agency") return null;

  const propertyType = extractPropertyType(lines);
  return {
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
    units,
    price,
    pricePerMeter,
    city: location.city,
    neighborhood: location.neighborhood,
    sellerType,
    verified: allText.some(x => /تأیید شده|تایید شده|احراز هویت شده/.test(x)),
    publishedText: item.publishedAt || null,
    publishedAt: item.publishedAt || null,
    ageHours: Math.round(age * 100) / 100,
    ageStatus: "known",
    source: "divar",
    url: item.url,
    token: item.token,
    originalTitle: null,
    descriptionUsed: false
  };
}

(async () => {
  const progressPath = "data/collector-progress.json";
  let all = [];
  let completedCities = new Set();

  if (fs.existsSync(progressPath)) {
    try {
      const progress = JSON.parse(fs.readFileSync(progressPath, "utf8"));
      if (Array.isArray(progress.listings)) all = progress.listings;
      if (Array.isArray(progress.completedCities)) {
        completedCities = new Set(progress.completedCities);
      }
      console.log(
        "RESUME: completed cities =",
        completedCities.size,
        "listings =",
        all.length
      );
    } catch (e) {
      console.log("PROGRESS CACHE ERROR:", e.message);
    }
  }

  const seen = new Set(all.map(item => item.token || item.url).filter(Boolean));

  try {
    console.log("Discovering Divar cities...");
    const cities = await getCities();
    console.log("CITY COUNT:", cities.length);

    for (const city of cities) {
      if (completedCities.has(city.slug)) {
        console.log("CITY SKIP:", city.slug);
        continue;
      }

      console.log("CITY:", city.slug);

      let links = [];
      try {
        links = await getListingLinks(city);
      } catch (e) {
        console.log("CITY ERROR:", city.slug, e.message);
        continue;
      }

      const queue = links.filter(item => {
        const key = item.token || item.url;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      for (let i = 0; i < queue.length; i += DETAIL_CONCURRENCY) {
        const batch = queue.slice(i, i + DETAIL_CONCURRENCY);

        const results = await Promise.all(
          batch.map(async item => {
            try {
              return await readListing(item);
            } catch (e) {
              console.log("LISTING ERROR:", item.token, e.message);
              return null;
            }
          })
        );

        for (const listing of results) {
          if (listing) all.push(listing);
        }

        if (i + DETAIL_CONCURRENCY < queue.length) {
          await new Promise(resolve =>
            setTimeout(resolve, CONCURRENCY_DELAY_MS)
          );
        }
      }

      completedCities.add(city.slug);

      fs.mkdirSync("data", { recursive: true });
      fs.writeFileSync(
        progressPath,
        JSON.stringify(
          {
            updatedAt: new Date().toISOString(),
            completedCities: [...completedCities],
            listings: all
          },
          null,
          2
        ),
        "utf8"
      );

      console.log(
        "CHECKPOINT:",
        city.slug,
        "completed;",
        "LISTINGS:",
        all.length
      );
    }

    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync("data/listings.json", JSON.stringify(all, null, 2), "utf8");
    fs.rmSync(progressPath, { force: true });

    console.log("FINAL COUNT:", all.length);
  } finally {
    // No browser to close: collection now uses Divar's public APIs directly.
  }
})();
