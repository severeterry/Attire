/**
 * Shared Supabase client for the whole site. Loaded (after the Supabase
 * CDN script, before every other app script) so window.supabaseClient is
 * ready wherever auth.js, membership.js, portal.js, etc. need it.
 */
(function () {
  "use strict";

  var SUPABASE_URL = "https://pnwsfxxtcexbavshxdmi.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_NacepTJjNW0FWnTJgyDGZg_N4cUSjPs";

  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
})();
