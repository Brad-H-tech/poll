// ============================================================
//  Sawubona configuration
// ============================================================
//  SOLO MODE (default): leave both values empty ("").
//  The app works fully on this phone — news, word of the day,
//  the quiz, streaks — but your leaderboard is just you.
//
//  SHARED MODE: create a free Supabase project (see SETUP.md in
//  this folder), run supabase-schema.sql, then paste your two
//  values below. Everyone who installs the app then plays on ONE
//  shared leaderboard — you, your girlfriend, your mates.
// ============================================================

// ("self" instead of "window" so the app's background helper can read this too)
self.SAWUBONA_CONFIG = {
  SUPABASE_URL: "",      // e.g. "https://abcdefgh.supabase.co"
  SUPABASE_ANON_KEY: "", // the long "anon / public" key

  // App branding — change these freely
  APP_NAME: "Sawubona",
  TAGLINE: "Your daily MTN, Zulu & tech brief",

  // Name of the shared board, shown at the top of the Board tab
  BOARD_NAME: "The Y'ello Board",
};
