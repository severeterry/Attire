/**
 * Attire directory taxonomy — categories and boroughs are fixed reference
 * data, so they stay static here. The actual directory listings moved to
 * the Supabase `directory_listings` table (originally transcribed from
 * "Directory and Details.xlsx", then re-verified against public sources —
 * see the verification pass in git history for that research). Fetch them
 * via directory.js's pattern: `sb.from("directory_listings").select("*")`.
 */

var CATEGORIES = [
  {
    id: "materials",
    label: "Materials & Making",
    color: "sage",
    blurb: "Fabric sourcing, manufacturing & cut-and-sew, deadstock & resale marketplaces",
  },
  {
    id: "circularity",
    label: "Circularity & Disposal",
    color: "terracotta",
    blurb: "Textile recycling, waste diversion & disposal",
  },
  {
    id: "strategy",
    label: "Strategy & Expertise",
    color: "slate",
    blurb: "Supply chain consultants & production technology",
  },
  {
    id: "advocacy",
    label: "Advocacy & Community",
    color: "gold",
    blurb: "NGOs, nonprofits & public institutions",
  },
  {
    id: "retail",
    label: "Retail & Creators",
    color: "plum",
    blurb: "Slow fashion designers, stores & secondhand marketplaces",
  },
];

var BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Staten Island", "Bronx", "NYC Presence"];
