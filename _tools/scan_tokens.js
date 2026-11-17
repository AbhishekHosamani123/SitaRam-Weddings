// Dev utility: locate exact literal tokens in the template HTML and data bundles.
// Usage: node -I _tools/scan_tokens.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const htmlPath = path.join(ROOT, "public", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

const patterns = [
  "Sita", "weds", "Ram", "Pathak", "Shalini", "Mittal", "Aakash", "Akash", "Drashti",
  "29th Aug 2026", "6 Pm Onwards", "Friday", "Pune", "Maharashtra", "Mumbai",
  "919819200906", "9819200906", "919876543210", "abkan", "Venue Name", "Full street address",
  "19.2183", "72.9781", "unsplash", "Mehendi", "Sangeet", "Ceremony", "Reception", "Shaadi",
  "Weather", "Staff", "Parking", "Hashtag", "Bhola", "Valet", "28 degrees", "mostly sunny",
  "Cordially", "Daughter of", "beloved son", "targetDate", "whatsappNumber", "countdown",
  "The countdown begins", "Meet the BRIDE", "Looking forward", "Mark Your Calendars",
  "In process", "Almost time", "Our hearts are full", "Shri Line", "Ganpati", "Temple",
  "Ram Mandir", "weds", "&", "and", "RSVP", "Full Name", "No. of People", "Select Event",
];

function firstContext(hay, needle) {
  const i = hay.indexOf(needle);
  if (i === -1) return null;
  const start = Math.max(0, i - 60);
  const end = Math.min(hay.length, i + needle.length + 60);
  return { at: i, ctx: JSON.stringify(hay.slice(start, end)) };
}

console.log("=== public/index.html (" + html.length + " bytes) ===");
for (const p of patterns) {
  let count = 0, idx = -1;
  while ((idx = html.indexOf(p, idx + 1)) !== -1) count++;
  const f = firstContext(html, p);
  console.log(`[${count}] ${JSON.stringify(p)} ${f ? "first@" + f.at + " " + f.ctx : "(not found)"}`);
}

// -- bundles --
const bundleDir = path.join(ROOT, "public", "mirror", "framerusercontent.com", "sites_1Jnwf2uoy3TohI0oOnOtPi");
const bundleFiles = fs.readdirSync(bundleDir).filter((f) => f.endsWith(".mjs"));
console.log("\n=== bundles (" + bundleFiles.length + " mjs) ===");
for (const f of bundleFiles) {
  const full = path.join(bundleDir, f);
  const s = fs.readFileSync(full, "utf8");
  const hits = [];
  for (const p of ["Sita", "Ram", "Pathak", "29th Aug 2026", "919819200906", "9819200906", "targetDate", "whatsappNumber", "Mehendi", "Sangeet", "Ceremony", "Reception", "Shaadi", "Pune", "abkan", "Mittal", "Shalini", "Akash", "Drashti"]) {
    let c = 0, idx = -1;
    while ((idx = s.indexOf(p, idx + 1)) !== -1) c++;
    if (c > 0) hits.push(`${p}x${c}`);
  }
  if (hits.length) console.log(f.slice(0, 24) + "… → " + hits.join(", "));
}

// searchIndex json
const jsonFiles = fs.readdirSync(bundleDir).filter((f) => f.endsWith(".json"));
console.log("\n=== searchIndex json ===");
for (const f of jsonFiles) {
  const s = fs.readFileSync(path.join(bundleDir, f), "utf8");
  let c = 0, idx = -1;
  while ((idx = s.indexOf("Sita", idx + 1)) !== -1) c++;
  console.log(f + " (" + s.length + " bytes) Sita x" + c);
}
