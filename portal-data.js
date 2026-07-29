/**
 * Seed content for the member portal demo (member-portal.html).
 * This is illustrative sample data for prototyping the feed/chat UI —
 * not live posts from the named organizations.
 */

var PORTAL_CURRENT_USER = { name: "Alex Rivera", initials: "AR", category: null };

var PORTAL_SEED_POSTS = [
  {
    id: "seed-1",
    authorName: "Rubi Laboratories",
    category: "circularity",
    type: "sourcing",
    body: "Looking for a NYC-based dye house comfortable running small pilot batches of our lab-grown viscose — reach out if that's you.",
    ageMs: 1000 * 60 * 40,
    likes: 6,
    liked: false,
    reposted: false,
    repostCount: 1,
    comments: [
      { author: "Circ", category: "circularity", body: "We ran into the same search last quarter — happy to compare notes.", ageMs: 1000 * 60 * 25 },
    ],
  },
  {
    id: "seed-2",
    authorName: "Reformation",
    category: "retail",
    type: "deal",
    body: "Sourcing a small-batch cut-and-sew partner in the boroughs for a limited run — quick turnaround, flexible MOQ preferred.",
    ageMs: 1000 * 60 * 60 * 3,
    likes: 9,
    liked: false,
    reposted: false,
    repostCount: 0,
    comments: [],
  },
  {
    id: "seed-3",
    authorName: "FabScrap",
    category: "circularity",
    type: "update",
    body: "Dropping off a fresh batch of Garment District deadstock at the Brooklyn warehouse this Thursday — members get first pick before the public resale shop opens.",
    ageMs: 1000 * 60 * 60 * 6,
    likes: 14,
    liked: true,
    reposted: false,
    repostCount: 3,
    comments: [
      { author: "Mood Fabrics", category: "materials", body: "Always good stuff in that batch, see you there.", ageMs: 1000 * 60 * 60 * 5 },
      { author: "Kordal Studio", category: "retail", body: "Is this the wool-heavy batch or more cotton this time?", ageMs: 1000 * 60 * 60 * 4 },
    ],
  },
  {
    id: "seed-4",
    authorName: "Sustainable Fashion Community Center",
    category: "advocacy",
    type: "update",
    body: "This month's Swap Shop diverted just under 300 lbs of clothing from landfill. Next one's the second Saturday of next month — always looking for a few extra hands.",
    ageMs: 1000 * 60 * 60 * 27,
    likes: 21,
    liked: false,
    reposted: true,
    repostCount: 5,
    comments: [],
  },
  {
    id: "seed-5",
    authorName: "Circ",
    category: "circularity",
    type: "update",
    body: "Great turnout at last week's mixer — thanks to everyone who stopped by to see the Circ Lyocell samples in person. More coming to a few member studios this month.",
    ageMs: 1000 * 60 * 60 * 30,
    likes: 11,
    liked: false,
    reposted: false,
    repostCount: 1,
    comments: [
      { author: "Gabriela Hearst", category: "retail", body: "The hand-feel on that sample was unreal, keep us posted.", ageMs: 1000 * 60 * 60 * 20 },
    ],
  },
  {
    id: "seed-6",
    authorName: "CFDA",
    category: "advocacy",
    type: "update",
    body: "Applications for this year's Sustainability track are opening soon — happy to answer questions in the thread if anyone's weighing whether to apply.",
    ageMs: 1000 * 60 * 60 * 48,
    likes: 8,
    liked: false,
    reposted: false,
    repostCount: 0,
    comments: [],
  },
];

var PORTAL_SEED_THREADS = [
  {
    id: "thread-fabscrap",
    name: "FabScrap",
    category: "circularity",
    unread: true,
    messages: [
      { from: "them", text: "Hey! Saw your deal board post about deadstock wool — we just got a big drop in.", ageMs: 1000 * 60 * 55 },
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
