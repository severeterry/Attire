/**
 * Seed content for the member portal demo (member-portal.html).
 * This is illustrative sample data for prototyping the DM chat UI —
 * not real conversations with the named organizations. Exchange posts
 * live in Supabase now, not here.
 */

var PORTAL_CURRENT_USER = { name: "Alex Rivera", initials: "AR", category: null };

var PORTAL_SEED_THREADS = [
  {
    id: "thread-fabscrap",
    name: "FabScrap",
    category: "circularity",
    unread: true,
    messages: [
      { from: "them", text: "Hey! Saw your Exchange post about deadstock wool — we just got a big drop in.", ageMs: 1000 * 60 * 55 },
      { from: "me", text: "Perfect timing, can I swing by this week to take a look?", ageMs: 1000 * 60 * 50 },
      { from: "them", text: "Thursday works, we'll set a bin aside for you.", ageMs: 1000 * 60 * 40 },
    ],
  },
  {
    id: "thread-circ",
    name: "Circ",
    category: "circularity",
    unread: true,
    messages: [
      { from: "them", text: "Thanks for stopping by the mixer last week!", ageMs: 1000 * 60 * 60 * 20 },
      { from: "me", text: "Of course, the Lyocell samples looked great.", ageMs: 1000 * 60 * 60 * 19 },
    ],
  },
  {
    id: "thread-reformation",
    name: "Reformation",
    category: "retail",
    unread: false,
    messages: [
      { from: "them", text: "Following up on the cut-and-sew RFP — do you have capacity for a 200-unit run?", ageMs: 1000 * 60 * 60 * 5 },
      { from: "me", text: "We can flex to that, sending over lead times now.", ageMs: 1000 * 60 * 60 * 4 },
      { from: "them", text: "Great, appreciate the quick turn.", ageMs: 1000 * 60 * 60 * 3 },
    ],
  },
  {
    id: "thread-sfcc",
    name: "Sustainable Fashion Community Center",
    category: "advocacy",
    unread: false,
    messages: [
      { from: "them", text: "We'd love an extra pair of hands at next month's Swap Shop if you're free.", ageMs: 1000 * 60 * 60 * 30 },
      { from: "me", text: "Count me in, send the details when you have them.", ageMs: 1000 * 60 * 60 * 28 },
    ],
  },
];
