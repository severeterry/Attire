/**
 * Default seed for the member profile page (profile.html).
 * Illustrative demo content for a single signed-in member, "Alex Rivera".
 */

var PROFILE_STORAGE_KEY = "attire-profile-v1";

var PROFILE_PRACTICE_OPTIONS = [
  "Deadstock / recycled materials",
  "Locally made in NYC",
  "Fair-trade / ethical labor",
  "Circular / take-back program",
  "Low-impact dyes",
  "B Corp certified",
  "Zero-waste pattern cutting",
  "Vegan / cruelty-free",
];

var PROFILE_DEFAULT = {
  name: "Alex Rivera",
  orgName: "Rivera Studio",
  category: "strategy",
  borough: "Brooklyn",
  bio: "Independent production consultant helping small NYC labels navigate sourcing and compliance. Always happy to trade notes on deadstock suppliers.",
  email: "alex@riverastudio.co",
  website: "riverastudio.co",
  practices: ["Locally made in NYC", "Deadstock / recycled materials"],
  avatar: null,
  memberSince: "2026",
  settings: {
    notifyMessages: true,
    notifyDealBoard: true,
    showInDirectory: true,
    dmFromAllMembers: true,
  },
};

function loadPortalProfile() {
  try {
    var raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  var fresh = JSON.parse(JSON.stringify(PROFILE_DEFAULT));
  try { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(fresh)); } catch (e) {}
  return fresh;
}

function savePortalProfile(profile) {
  try { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile)); } catch (e) {}
}

/**
 * Connections between members. Stored as a flat list of requests:
 * { id, from, to, status: "pending" | "accepted" }
 * "from" is whoever sent the request. Once accepted, the relationship is
 * mutual regardless of who originally sent it.
 */
var CONNECTIONS_KEY = "attire-connections-v1";

function loadConnections() {
  try {
    var raw = localStorage.getItem(CONNECTIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function saveConnections(list) {
  try { localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(list)); } catch (e) {}
}

function findConnectionRecord(list, nameA, nameB) {
  return list.find(function (r) {
    return (r.from === nameA && r.to === nameB) || (r.from === nameB && r.to === nameA);
  });
}

// Relationship of "me" toward "other": null, or { status, direction, record }
// direction is "outgoing" (I sent it) or "incoming" (they sent it) while pending.
function getRelationship(myName, otherName) {
  var list = loadConnections();
  var record = findConnectionRecord(list, myName, otherName);
  if (!record) return null;
  if (record.status === "accepted") return { status: "accepted", record: record };
  return { status: "pending", direction: record.from === myName ? "outgoing" : "incoming", record: record };
}

function sendConnectionRequest(myName, otherName) {
  var list = loadConnections();
  if (findConnectionRecord(list, myName, otherName)) return;
  list.push({ id: "conn-" + Date.now(), from: myName, to: otherName, status: "pending", createdAt: Date.now() });
  saveConnections(list);
}

// Seeds one incoming demo connection request the first time this ever runs,
// so the notifications drawer isn't empty on a fresh profile.
function seedConnectionsIfEmpty(myName) {
  var raw = null;
  try { raw = localStorage.getItem(CONNECTIONS_KEY); } catch (e) {}
  if (raw !== null) return;
  saveConnections([
    { id: "conn-seed-1", from: "Reformation", to: myName, status: "pending", createdAt: Date.now() - 1000 * 60 * 50 },
  ]);
}

function respondToConnectionRequest(myName, otherName, accept) {
  var list = loadConnections();
  var record = findConnectionRecord(list, myName, otherName);
  if (!record) return;
  if (accept) {
    record.status = "accepted";
    saveConnections(list);
  } else {
    saveConnections(list.filter(function (r) { return r !== record; }));
  }
}

function removeConnection(myName, otherName) {
  var list = loadConnections();
  saveConnections(list.filter(function (r) { return !(findConnectionRecord([r], myName, otherName)); }));
}

function countConnections(name) {
  return loadConnections().filter(function (r) { return r.status === "accepted" && (r.from === name || r.to === name); }).length;
}

function incomingRequestsFor(name) {
  return loadConnections().filter(function (r) { return r.status === "pending" && r.to === name; });
}

function acceptedConnectionsFor(name) {
  return loadConnections().filter(function (r) { return r.status === "accepted" && (r.from === name || r.to === name); })
    .map(function (r) { return r.from === name ? r.to : r.from; });
}

/**
 * Activity notifications (likes/comments on your posts). Illustrative demo
 * content, seeded once so the notifications drawer has something to show.
 */
var NOTIFICATIONS_KEY = "attire-notifications-v1";
var NOTIFICATIONS_SEED = [
  { id: "notif-1", type: "like", actor: "FabScrap", category: "circularity", ageMs: 1000 * 60 * 35 },
  { id: "notif-2", type: "comment", actor: "Circ", category: "circularity", body: "This is great, would love to collaborate.", ageMs: 1000 * 60 * 60 * 2 },
  { id: "notif-3", type: "like", actor: "Mood Fabrics", category: "materials", ageMs: 1000 * 60 * 60 * 5 },
];

function loadActivityNotifications() {
  try {
    var raw = localStorage.getItem(NOTIFICATIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  var now = Date.now();
  var fresh = NOTIFICATIONS_SEED.map(function (n) {
    return { id: n.id, type: n.type, actor: n.actor, category: n.category, body: n.body || null, createdAt: now - n.ageMs };
  });
  try { localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(fresh)); } catch (e) {}
  return fresh;
}

// Combines static activity notifications with live incoming connection
// requests into one feed, newest first.
function getNotificationFeed(myName) {
  var activity = loadActivityNotifications();
  var requests = incomingRequestsFor(myName).map(function (r) {
    return { id: r.id, type: "connect_request", actor: r.from, category: null, body: null, createdAt: r.createdAt || Date.now() };
  });
  return activity.concat(requests).sort(function (a, b) { return b.createdAt - a.createdAt; });
}
