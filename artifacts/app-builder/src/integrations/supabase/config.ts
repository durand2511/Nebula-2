// Public Supabase connection config.
// The publishable (anon) key is safe to expose in the client bundle.
// Values come from env (.env / Vite) with public fallbacks so production
// builds work even if env vars are not injected at build time.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://yyodrhzawnrcrxggreue.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5b2RyaHphd25yY3J4Z2dyZXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjc5MDMsImV4cCI6MjA4OTk0MzkwM30.yS_AcxclJ4ffC-i6EOqCYWy8bLBiVOOdWJmQP7jcXq8";
