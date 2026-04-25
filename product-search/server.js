const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const { URL } = require("url");
require("dotenv").config();

const app = express();
app.use(cors());

const SERPAPI_KEY = process.env.SERPAPI_KEY; // <-- Replace with your SerpAPI key

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "with",
  "from",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "image",
  "images",
  "photo",
  "photos",
  "picture",
  "pictures",
  "view",
  "official",
  "product"
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function getDomain(value) {
  if (!value) return "unknown";

  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return String(value).replace(/^www\./, "").toLowerCase();
  }
}

function jaccardSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersectionSize = 0;

  for (const token of setA) {
    if (setB.has(token)) intersectionSize += 1;
  }

  const unionSize = new Set([...setA, ...setB]).size;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function hasWhiteBackgroundHint(text) {
  return /white background|isolated|studio shot|catalog|packshot/.test(
    String(text || "").toLowerCase()
  );
}

function hasLifestyleHint(text) {
  return /review|hands on|in use|lifestyle|people|model|room|outdoor/.test(
    String(text || "").toLowerCase()
  );
}

function detectAngle(text) {
  const normalized = String(text || "").toLowerCase();

  if (/\bfront\b/.test(normalized)) return "front";
  if (/\bside\b|\bprofile\b/.test(normalized)) return "side";
  if (/\btop\b|\boverhead\b/.test(normalized)) return "top";
  if (/\bback\b/.test(normalized)) return "back";

  return null;
}

function normalizeAngleNeutralTokens(text) {
  const angleWords = new Set([
    "front",
    "side",
    "profile",
    "top",
    "back",
    "view",
    "angle"
  ]);

  return tokenize(text).filter((token) => !angleWords.has(token));
}

function isDuplicateLooking(item, selectedItems) {
  const currentTokens = normalizeAngleNeutralTokens(`${item.title} ${item.altText}`);
  if (!currentTokens.length) return false;

  for (const selectedItem of selectedItems) {
    const selectedTokens = normalizeAngleNeutralTokens(
      `${selectedItem.title} ${selectedItem.altText}`
    );
    const similarity = jaccardSimilarity(currentTokens, selectedTokens);

    // Very high overlap usually means the listing is the same repeated shot.
    if (similarity >= 0.92) {
      return true;
    }
  }

  return false;
}

function pickBestCandidate(list, usedUrls, selectedItems, allowSimilar = false) {
  for (const item of list) {
    if (usedUrls.has(item.imageUrl)) continue;
    if (!allowSimilar && isDuplicateLooking(item, selectedItems)) continue;
    return item;
  }

  return null;
}

app.get("/api/search", async (req, res) => {
  const objectName = req.query.q;
  if (!objectName) {
    return res.status(400).json({ error: "Missing query parameter: q" });
  }

  // One query only, as requested.
  const query = `${objectName} product images multiple angles white background`;
  const url = `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(query)}&num=20&api_key=${SERPAPI_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    // Step 1: pull 10-15+ candidates from SerpAPI (we request up to 20).
    const rawImages = Array.isArray(data.images_results)
      ? data.images_results.slice(0, 20)
      : [];

    const candidates = rawImages
      .map((item) => {
        const imageUrl = item.original || item.thumbnail || null;
        const title = item.title || "";
        const altText = item.snippet || item.original_title || "";
        const source = item.source || "";
        const sourceDomain = getDomain(item.link || source);
        const tokens = tokenize(title);
        const angle = detectAngle(`${title} ${altText}`);

        return {
          imageUrl,
          title,
          altText,
          source,
          sourceDomain,
          angle,
          tokens,
          textForHints: `${title} ${altText} ${source}`
        };
      })
      .filter((item) => item.imageUrl);

    if (!candidates.length) {
      return res.json({ front: null, side: null, top: null, back: null });
    }

    const objectTokens = tokenize(objectName);

    // Step 2a: frequency maps for "similar titles" and "similar domains".
    const domainFrequency = {};
    const tokenFrequency = {};

    for (const item of candidates) {
      domainFrequency[item.sourceDomain] = (domainFrequency[item.sourceDomain] || 0) + 1;

      for (const token of item.tokens) {
        tokenFrequency[token] = (tokenFrequency[token] || 0) + 1;
      }
    }

    // Step 2b: first-pass score by title similarity, domain consistency, and clean-background hints.
    const firstPass = candidates.map((item) => {
      let titleSimilarityScore = 0;
      for (const token of item.tokens) {
        titleSimilarityScore += tokenFrequency[token] || 0;
      }

      const domainSimilarityScore = (domainFrequency[item.sourceDomain] || 0) * 5;
      const objectMatchScore = objectTokens.filter((token) => item.tokens.includes(token)).length * 4;
      const whiteBackgroundScore = hasWhiteBackgroundHint(item.textForHints) ? 8 : 0;
      const lifestylePenalty = hasLifestyleHint(item.textForHints) ? -6 : 0;

      return {
        ...item,
        firstPassScore:
          titleSimilarityScore +
          domainSimilarityScore +
          objectMatchScore +
          whiteBackgroundScore +
          lifestylePenalty
      };
    });

    firstPass.sort((a, b) => b.firstPassScore - a.firstPassScore);

    // Use best item as anchor so we keep images likely from the same exact product.
    const anchor = firstPass[0];

    // Step 2c: second-pass score adds title overlap and same-domain bonus vs anchor image.
    const secondPass = firstPass.map((item) => {
      const similarityToAnchor = jaccardSimilarity(item.tokens, anchor.tokens);
      const sameDomainAsAnchor = item.sourceDomain === anchor.sourceDomain ? 6 : 0;

      return {
        ...item,
        finalScore: item.firstPassScore + similarityToAnchor * 20 + sameDomainAsAnchor
      };
    });

    secondPass.sort((a, b) => b.finalScore - a.finalScore);

    // Step 3: bucket by detected angle so we can prioritize diversity.
    const angleBuckets = {
      front: [],
      side: [],
      top: [],
      back: [],
      unknown: []
    };

    for (const item of secondPass) {
      if (item.angle && angleBuckets[item.angle]) {
        angleBuckets[item.angle].push(item);
      } else {
        angleBuckets.unknown.push(item);
      }
    }

    // Step 4: select one image per angle first, then fallback if a bucket is empty.
    const result = { front: null, side: null, top: null, back: null };
    const selectedItems = [];
    const usedUrls = new Set();
    const targetAngles = ["front", "side", "top", "back"];

    for (const angle of targetAngles) {
      let picked = pickBestCandidate(angleBuckets[angle], usedUrls, selectedItems);

      // If all candidates looked too similar, allow the best remaining one.
      if (!picked) {
        picked = pickBestCandidate(angleBuckets[angle], usedUrls, selectedItems, true);
      }

      if (picked) {
        result[angle] = picked.imageUrl;
        selectedItems.push(picked);
        usedUrls.add(picked.imageUrl);
      }
    }

    // Fallback: fill missing angles from any remaining candidates.
    const fallbackPool = [...angleBuckets.unknown, ...secondPass];

    for (const angle of targetAngles) {
      if (result[angle]) continue;

      let picked = pickBestCandidate(fallbackPool, usedUrls, selectedItems);
      if (!picked) {
        picked = pickBestCandidate(fallbackPool, usedUrls, selectedItems, true);
      }

      if (picked) {
        result[angle] = picked.imageUrl;
        selectedItems.push(picked);
        usedUrls.add(picked.imageUrl);
      }
    }

    res.json(result);
  } catch (err) {
    console.error("Error fetching images:", err.message);
    res.status(500).json({ error: "Failed to fetch product images" });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});