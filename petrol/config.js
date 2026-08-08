// ============================================================
//  SlipStream configuration
// ============================================================
//  DEMO MODE (default): leave both values empty ("").
//  The app runs entirely on this phone — perfect for trying it
//  out, but data is NOT shared between people.
//
//  TEAM MODE: create a free Supabase project (see SETUP.md in
//  this folder), then paste your two values below and push.
//  Everyone then shares one database: real logins, slips backed
//  up in the cloud, and you can see the whole team's expenses.
// ============================================================

window.SLIPSTREAM_CONFIG = {
  SUPABASE_URL: "",      // e.g. "https://abcdefgh.supabase.co"
  SUPABASE_ANON_KEY: "", // the long "anon / public" key

  // App branding — change these freely
  APP_NAME: "SlipStream",
  TAGLINE: "Petrol slip tracker",
  CURRENCY: "R",

  // DEMO MODE ONLY: the code that unlocks the admin view on this
  // phone. In team mode the admin code is set in Supabase instead
  // (see supabase-schema.sql) so it can't be read from this file.
  ADMIN_CODE: "2468",
};
