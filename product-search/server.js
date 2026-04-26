const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const { URL } = require("url");
const { promisify } = require("util");
const mysql = require("mysql2");
const cloudinary = require("cloudinary").v2;
require("dotenv").config();

const app = express();
app.use(cors());

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

const hasValidCloudName = /^[a-z0-9_-]+$/i.test(String(CLOUDINARY_CLOUD_NAME || ""));
const isCloudinaryConfigured = Boolean(
  CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET && hasValidCloudName
);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET
  });
}

// ✅ DB CONNECTION (ONLY ONCE)
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: process.env.DB_PASSWORD,
  database: "product_images",
  port: 3307
});

const dbQuery = promisify(db.query).bind(db);

db.connect((err) => {
  if (err) console.error("DB connection failed:", err);
  else console.log("Connected to MySQL");
});

// ---------------- UTIL FUNCTIONS ----------------

const STOP_WORDS = new Set([
  "a","an","the","and","or","for","with","from","to","of","in","on","at","by",
  "image","images","photo","photos","picture","pictures","view","official","product"
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function getDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "unknown";
  }
}

function jaccardSimilarity(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  return intersection / new Set([...setA, ...setB]).size || 0;
}

function detectAngle(text) {
  text = String(text).toLowerCase();
  if (text.includes("front")) return "front";
  if (text.includes("side")) return "side";
  if (text.includes("top")) return "top";
  if (text.includes("back")) return "back";
  return null;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown-product";
}

let cloudinaryWarningShown = false;

async function uploadToCloudinary(imageUrl, productName = "misc") {
  if (!imageUrl) return null;

  if (!isCloudinaryConfigured) {
    if (!cloudinaryWarningShown) {
      cloudinaryWarningShown = true;
      console.warn("Cloudinary is not configured correctly. Using original image URLs as fallback.");
    }
    return null;
  }

  try {
    const uploaded = await cloudinary.uploader.upload(imageUrl, {
      folder: `products/${slugify(productName)}`
    });
    return uploaded?.secure_url || null;
  } catch (error) {
    console.error("Cloudinary upload failed:", error.message);
    return null;
  }
}

// ---------------- MAIN API ----------------

app.get("/api/search", async (req, res) => {
  const objectName = req.query.q;

  if (!objectName) {
    return res.status(400).json({ error: "Missing query" });
  }

  try {
    // ✅ STEP 1: CHECK DB FIRST (CACHE)
    const results = await dbQuery("SELECT * FROM images WHERE name = ?", [objectName]);
    if (results.length > 0) {
      console.log("⚡ Fetched from DB");
      return res.json(results[0]);
    }

    console.log("🌐 Fetching from API...");

    const query = `${objectName} product multiple angles white background`;
    const url = `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(query)}&num=20&api_key=${SERPAPI_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    const images = (data.images_results || []).slice(0, 20);

    const candidates = images.map((item) => ({
      url: item.original || item.thumbnail,
      text: `${item.title} ${item.snippet}`,
      angle: detectAngle(`${item.title} ${item.snippet}`)
    }));

    const result = { front: null, side: null, top: null, back: null };

    for (const item of candidates) {
      if (!item.url) continue;
      if (!result[item.angle]) result[item.angle] = item.url;
    }

    // fallback
    for (const key of ["front", "side", "top", "back"]) {
      if (!result[key]) {
        const fallback = candidates.find((c) => c.url);
        result[key] = fallback?.url || null;
      }
    }

    const uploadedResult = {
      front: (await uploadToCloudinary(result.front, objectName)) || result.front,
      side: (await uploadToCloudinary(result.side, objectName)) || result.side,
      top: (await uploadToCloudinary(result.top, objectName)) || result.top,
      back: (await uploadToCloudinary(result.back, objectName)) || result.back
    };

    // ✅ STEP 2: SAVE TO DB (CLOUDINARY URLS WITH FALLBACK)
    await dbQuery(
      "INSERT INTO images (name, front, side, top, back) VALUES (?, ?, ?, ?, ?)",
      [objectName, uploadedResult.front, uploadedResult.side, uploadedResult.top, uploadedResult.back]
    );
    console.log("💾 Saved to DB");

    // ✅ STEP 3: SEND RESPONSE
    return res.json(uploadedResult);
  } catch (err) {
    console.error("API Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch images" });
  }
});


// ---------------- SERVER ----------------

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});