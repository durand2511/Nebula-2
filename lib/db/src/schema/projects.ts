import { pgTable, serial, text, timestamp, integer, real, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Platform (builder) user accounts — each account owns its own projects (multi-tenant). Separate
// from studio_users, which are per-project booking-app customers.
export const platformUsers = pgTable("platform_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull().default(""),
  birthdate: text("birthdate").notNull().default(""), // yyyy-mm-dd
  phone: text("phone").notNull().default(""),
  // Billing (Nebula platform subscription €69,99/mo + AI credit wallet, in EUR).
  stripeCustomerId: text("stripe_customer_id").notNull().default(""),
  subscriptionId: text("subscription_id").notNull().default(""),
  subscriptionStatus: text("subscription_status").notNull().default("none"), // none | active | past_due | canceled
  currentPeriodEnd: text("current_period_end").notNull().default(""),         // yyyy-mm-dd
  aiCredit: real("ai_credit").notNull().default(0),                            // euros of AI budget left
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Per-AI-change billing log (what each chat edit cost, after the ×2 markup).
export const platformAiUsage = pgTable("platform_ai_usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => platformUsers.id, { onDelete: "cascade" }),
  projectId: integer("project_id"),
  summary: text("summary").notNull().default(""),
  costEur: real("cost_eur").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const platformSessions = pgTable("platform_sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull().references(() => platformUsers.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").references(() => platformUsers.id, { onDelete: "cascade" }), // null = legacy/unowned
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  source: text("source").notNull().default("jordy"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projectMessages = pgTable("project_messages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projectFiles = pgTable("project_files", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  content: text("content").notNull().default(""),
  language: text("language").notNull().default("plaintext"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Undo history: a full snapshot of a project's files taken BEFORE a mutating action
// (a /command edit or an AI build). "draai terug"/"maak ongedaan" restores the latest one.
export const projectSnapshots = pgTable("project_snapshots", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  label: text("label").notNull().default(""),
  // JSON: Array<{ path: string; content: string; language: string }> — the pre-change file state.
  files: text("files").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// One Stripe Connect (Express) account per project/studio, so customer payments go to the
// right studio. Created during onboarding; charges_enabled flips true once onboarding is done.
export const projectStripe = pgTable("project_stripe", {
  projectId: integer("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  chargesEnabled: text("charges_enabled").notNull().default("false"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Scheduled "24h before the class" reminder e-mails. A row is created when a class is booked;
// a background scheduler sends it once sendAt has passed (and deletes it on cancel).
export const emailReminders = pgTable("email_reminders", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  bookingId: text("booking_id").notNull().default(""),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  classTitle: text("class_title").notNull().default(""),
  studio: text("studio").notNull().default(""),
  lessonAt: timestamp("lesson_at", { withTimezone: true }).notNull(),
  sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
  sent: text("sent").notNull().default("false"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Per-studio SMTP e-mail configuration (entered in the booking app's "Communicatie" screen).
// The password is stored ENCRYPTED (AES-256-GCM, see lib/email-config.ts) and never returned
// to the client. Host/port/secure are derived from the e-mail provider (Gmail/Outlook).
export const projectEmail = pgTable("project_email", {
  projectId: integer("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull().default(587),
  smtpSecure: text("smtp_secure").notNull().default("false"),
  // AES-256-GCM payload "iv:tag:ciphertext" (all base64). Never exposed via the API.
  passEncrypted: text("pass_encrypted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Per-site SEO/AEO content engine settings + the Google Search Console connection (refresh token
// is stored ENCRYPTED, like the e-mail password). Auto-publishing runs on a scheduler.
export const projectSeo = pgTable("project_seo", {
  projectId: integer("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  autoEnabled: text("auto_enabled").notNull().default("false"),
  cadenceDays: integer("cadence_days").notNull().default(7),
  language: text("language").notNull().default("nl"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  // Quality-gated publishing: max articles/day, and the minimum qualityScore for AUTO publish.
  maxPerDay: integer("max_per_day").notNull().default(1),
  autoPublishMin: integer("auto_publish_min").notNull().default(85),
  gscRefreshEnc: text("gsc_refresh_enc").notNull().default(""),
  gscSiteUrl: text("gsc_site_url").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Generated SEO articles: status (draft/published/rejected), qualityScore, intent, and the full
// pipeline JSON payload (so drafts can be reviewed/published later without regenerating).
export const seoArticles = pgTable("seo_articles", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  query: text("query").notNull().default(""),
  source: text("source").notNull().default("ai"),
  status: text("status").notNull().default("published"),
  score: integer("score").notNull().default(0),
  intent: text("intent").notNull().default(""),
  payload: text("payload").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// A studio's legally-required invoice details (filled in the booking app's Facturatie tab).
export const projectInvoice = pgTable("project_invoice", {
  projectId: integer("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  company: text("company").notNull().default(""),
  address: text("address").notNull().default(""),
  postcode: text("postcode").notNull().default(""),
  city: text("city").notNull().default(""),
  country: text("country").notNull().default("NL"),  // NL | UK | US — bepaalt labels, valuta, belastingnaam
  currency: text("currency").notNull().default("EUR"),
  kvk: text("kvk").notNull().default(""),             // generiek registratienummer: KvK / Company no. / EIN
  vat: text("vat").notNull().default(""),             // generiek belasting-ID: BTW-nummer / VAT reg. no.
  vatPercent: integer("vat_percent").notNull().default(21),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// One row per issued invoice — the unique sequential number lives here (year-NNNN).
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  date: text("date").notNull().default(""),          // dd-mm-yyyy
  customerName: text("customer_name").notNull().default(""),
  customerEmail: text("customer_email").notNull().default(""),
  description: text("description").notNull().default(""),
  total: real("total").notNull().default(0),         // incl. belasting
  vatPercent: integer("vat_percent").notNull().default(21),
  country: text("country").notNull().default("NL"),
  currency: text("currency").notNull().default("EUR"),
  method: text("method").notNull().default("Stripe"),
  status: text("status").notNull().default("Betaald"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Calendar feed: the booking app syncs its lessons here; the studio subscribes to the .ics URL
// (token-protected) in Google/Outlook/Apple, so new lessons appear automatically.
export const projectCalendar = pgTable("project_calendar", {
  projectId: integer("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  token: text("token").notNull().default(""),
  lessons: text("lessons").notNull().default("[]"),  // JSON array of {id,title,date,time,mode,onlineLink,onlineInfo,teacher}
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Custom domains a customer connects to their site. One domain → one project (unique).
// status: pending (added) → verified (DNS points to customers.nebulabookings.com) → active (served).
export const domains = pgTable("domains", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Mindbody migration/import (server-side; bridged into the booking app on activation) ──
// Imported customers (deduped per project on e-mail). NO credit-card data is ever stored.
export const importCustomers = pgTable("import_customers", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  phone: text("phone").notNull().default(""),
  notes: text("notes").notNull().default(""),
  source: text("source").notNull().default("mindbody"),
  activated: text("activated").notNull().default("false"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// A class pack or membership belonging to an imported customer (by e-mail).
export const importEntitlements = pgTable("import_entitlements", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  kind: text("kind").notNull(),                       // class_pack | membership
  name: text("name").notNull().default(""),
  status: text("status").notNull().default("active"), // active | expired | depleted | cancelled | payment_required
  total: integer("total"),                            // pack total
  remaining: integer("remaining"),                    // pack remaining OR membership remaining-this-month
  unlimited: text("unlimited").notNull().default("false"),
  perMonth: integer("per_month"),                     // membership classes/month
  price: real("price"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),  // pack expiry OR membership end
  nextPaymentAt: timestamp("next_payment_at", { withTimezone: true }),
  needsPayment: text("needs_payment").notNull().default("false"), // no card imported → ask later (Stripe TODO)
  raw: text("raw").notNull().default(""),             // original CSV row as JSON (no card data)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// One-time, hashed account-activation tokens (raw token only ever lives in the e-mail link).
export const activationTokens = pgTable("activation_tokens", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull(),
  used: text("used").notNull().default("false"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Server-side booking-app data (replaces the per-browser localStorage state) ──
// Multi-tenant: every row is scoped to a project. This is the "product-ready" datastore so a
// studio's accounts/classes/bookings/credits live on the server, shared across devices & browsers.

// Booking-app users (admin/teacher/client). Passwords are scrypt-hashed — never stored in plaintext.
export const studioUsers = pgTable("studio_users", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("client"), // admin | teacher | client
  name: text("name").notNull().default(""),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  passwordHash: text("password_hash").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projEmail: uniqueIndex("studio_users_proj_email").on(t.projectId, t.email) }));

// Opaque session tokens (the client stores only the token, never the data/password).
export const studioSessions = pgTable("studio_sessions", {
  token: text("token").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => studioUsers.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Scheduled lessons (real dates). Mirrors the old localStorage class object incl. booking window.
export const studioClasses = pgTable("studio_classes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  teacherEmail: text("teacher_email").notNull().default(""),
  teacher: text("teacher").notNull().default(""),
  date: text("date").notNull().default(""),          // yyyy-mm-dd
  time: text("time").notNull().default(""),
  cap: integer("cap").notNull().default(12),
  price: real("price").notNull().default(0),
  mode: text("mode").notNull().default("fysiek"),    // fysiek | online | hybride
  onlineLink: text("online_link").notNull().default(""),
  onlineInfo: text("online_info").notNull().default(""),
  bookDays: integer("book_days").notNull().default(0),     // 0 = no limit
  cancelHours: integer("cancel_hours").notNull().default(0), // 0 = always cancelable
  locationId: integer("location_id").notNull().default(0),   // 0 = no specific location (studio_locations.id)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ byProj: index("studio_classes_proj").on(t.projectId) }));

// The PUBLISHED snapshot of a project's site (draft → publish model). serveProjectSite serves this
// snapshot, so edits in the builder are a draft until the user re-publishes. `files` is a JSON map
// path → { content, language }. Auto-published SEO articles re-snapshot automatically.
export const sitePublishes = pgTable("site_publishes", {
  projectId: integer("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  files: text("files").notNull().default("{}"),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
});

// Per-studio toggles. Additive: a missing row means all defaults (everything off).
export const studioSettings = pgTable("studio_settings", {
  projectId: integer("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  ownerReport: text("owner_report").notNull().default("off"),   // off | weekly | monthly — auto report to admins
  reviewUrl: text("review_url").notNull().default(""),          // Google review link; set = auto review request after 1st class
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Sent "smart reminder" nudges (low credits / renewal soon / win-back) — one row per situation
// so a daily scanner never sends the same nudge twice. `ref` buckets the situation (e.g. the
// renewal date, or a month for win-back).
export const studioNudges = pgTable("studio_nudges", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull().default(""),
  kind: text("kind").notNull().default(""),   // lowcredits | renewal | winback
  ref: text("ref").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ uniq: uniqueIndex("studio_nudges_uniq").on(t.projectId, t.email, t.kind, t.ref) }));

// Optional physical locations for multi-location studios. Additive: with none defined the app
// behaves as a single-location studio. Credits/passes are shared across locations.
export const studioLocations = pgTable("studio_locations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull().default(""),
  address: text("address").notNull().default(""),
  active: text("active").notNull().default("true"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ byProj: index("studio_locations_proj").on(t.projectId) }));

// Membership TYPES the studio sells (strippenkaart / abonnement).
export const studioMembers = pgTable("studio_members", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull().default(""),
  type: text("type").notNull().default("strippenkaart"), // strippenkaart | abonnement
  unlimited: text("unlimited").notNull().default("false"),
  credits: integer("credits"),
  price: real("price").notNull().default(0),
  validDays: integer("valid_days").notNull().default(30),
  recurring: text("recurring").notNull().default("false"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ byProj: index("studio_members_proj").on(t.projectId) }));

// Per-customer tegoed (credits / abonnement / X-per-maand). One row per (project, e-mail).
export const studioWallets = pgTable("studio_wallets", {
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  credits: integer("credits").notNull().default(0),
  membership: text("membership"),                    // abonnement name, or null
  unlimited: text("unlimited").notNull().default("false"),
  monthlyLimit: integer("monthly_limit"),
  monthlyRemaining: integer("monthly_remaining"),
  monthlyPeriod: text("monthly_period").notNull().default(""), // YYYY-MM
  validUntil: text("valid_until"),                   // yyyy-mm-dd
  needsPayment: text("needs_payment").notNull().default("false"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projEmail: uniqueIndex("studio_wallets_proj_email").on(t.projectId, t.email) }));

// Bookings (booked / waitlist / cancelled). Capacity is enforced server-side at booking time.
export const studioBookings = pgTable("studio_bookings", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  classId: integer("class_id").notNull(),
  date: text("date").notNull().default(""),
  bookerEmail: text("booker_email").notNull().default(""),
  name: text("name").notNull().default(""),
  status: text("status").notNull().default("booked"), // booked | waitlist | cancelled
  payment: text("payment").notNull().default("tegoed"),
  usedCredit: text("used_credit").notNull().default("false"),
  usedMonthly: text("used_monthly").notNull().default("false"),
  present: text("present").notNull().default("false"),
  noShow: text("no_show").notNull().default("false"), // gemarkeerd als no-show → tegoed wordt niet terugbetaald
  paymentIntent: text("payment_intent").notNull().default(""),
  amount: real("amount").notNull().default(0),
  refunded: text("refunded").notNull().default("false"),
  refundedAmount: real("refunded_amount"),
  cancelledAt: text("cancelled_at").notNull().default(""),
  promotedAt: text("promoted_at").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ byProj: index("studio_bookings_proj").on(t.projectId), byClass: index("studio_bookings_class").on(t.classId, t.date) }));

// Stripe purchases of a strippenkaart/abonnement (so the admin can refund).
export const studioPurchases = pgTable("studio_purchases", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull().default(""),
  type: text("type").notNull().default("strippenkaart"),
  name: text("name").notNull().default(""),
  amount: real("amount").notNull().default(0),
  paymentIntent: text("payment_intent").notNull().default(""),
  subscription: text("subscription").notNull().default(""),
  refunded: text("refunded").notNull().default("false"),
  refundedAmount: real("refunded_amount"),
  date: text("date").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ byProj: index("studio_purchases_proj").on(t.projectId) }));

// Video library (links only — YouTube/Vimeo/MP4 URL). Categories: yoga | mindfulness | pilates.
export const studioVideos = pgTable("studio_videos", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  category: text("category").notNull().default("yoga"),
  title: text("title").notNull().default(""),
  url: text("url").notNull().default(""),
  weekNo: integer("week_no").notNull().default(1), // program week — unlocks N weeks after a subscriber starts
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ byProj: index("studio_videos_proj").on(t.projectId) }));

// Per-category video subscription price the studio sets (purchase + access gating come in step 2).
export const studioVideoPlans = pgTable("studio_video_plans", {
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  price: real("price").notNull().default(0),
  validDays: integer("valid_days").notNull().default(30),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projCat: uniqueIndex("studio_video_plans_proj_cat").on(t.projectId, t.category) }));

// Which customer has access to which video category, until when (granted after a paid subscription).
export const studioVideoAccess = pgTable("studio_video_access", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  category: text("category").notNull(),
  validUntil: text("valid_until").notNull().default(""), // yyyy-mm-dd
  startedAt: text("started_at").notNull().default(""), // yyyy-mm-dd — when access first started (for the weekly drip)
  subscription: text("subscription").notNull().default(""), // Stripe subscription id (recurring)
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projEmailCat: uniqueIndex("studio_video_access_proj_email_cat").on(t.projectId, t.email, t.category), bySub: index("studio_video_access_sub").on(t.subscription) }));

// Discount codes / promos / gift cards. kind: percent (% off) | fixed (€ off) | gift (€ balance spent down).
export const studioCodes = pgTable("studio_codes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  code: text("code").notNull(),              // stored uppercase
  kind: text("kind").notNull().default("percent"),
  value: real("value").notNull().default(0), // percent, or € off, or initial gift balance
  balance: real("balance").notNull().default(0), // remaining balance for gift cards
  expiresAt: text("expires_at").notNull().default(""), // yyyy-mm-dd, "" = none
  maxUses: integer("max_uses").notNull().default(0),   // 0 = unlimited
  uses: integer("uses").notNull().default(0),
  active: text("active").notNull().default("true"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projCode: uniqueIndex("studio_codes_proj_code").on(t.projectId, t.code) }));

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectMessageSchema = createInsertSchema(projectMessages).omit({
  id: true,
  createdAt: true,
});

export const insertProjectFileSchema = createInsertSchema(projectFiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type ProjectMessage = typeof projectMessages.$inferSelect;
export type InsertProjectMessage = z.infer<typeof insertProjectMessageSchema>;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;
export type ProjectSnapshot = typeof projectSnapshots.$inferSelect;
export type ProjectStripe = typeof projectStripe.$inferSelect;
export type EmailReminder = typeof emailReminders.$inferSelect;
export type ProjectEmail = typeof projectEmail.$inferSelect;
export type ProjectSeo = typeof projectSeo.$inferSelect;
export type SeoArticle = typeof seoArticles.$inferSelect;
export type ProjectInvoice = typeof projectInvoice.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Domain = typeof domains.$inferSelect;
export type ImportCustomer = typeof importCustomers.$inferSelect;
export type ImportEntitlement = typeof importEntitlements.$inferSelect;
export type ActivationToken = typeof activationTokens.$inferSelect;
export type StudioUser = typeof studioUsers.$inferSelect;
export type StudioSession = typeof studioSessions.$inferSelect;
export type StudioClass = typeof studioClasses.$inferSelect;
export type StudioMember = typeof studioMembers.$inferSelect;
export type StudioWallet = typeof studioWallets.$inferSelect;
export type StudioBooking = typeof studioBookings.$inferSelect;
export type StudioPurchase = typeof studioPurchases.$inferSelect;
export type StudioVideo = typeof studioVideos.$inferSelect;
export type StudioVideoPlan = typeof studioVideoPlans.$inferSelect;
export type StudioVideoAccess = typeof studioVideoAccess.$inferSelect;
export type StudioCode = typeof studioCodes.$inferSelect;
export type StudioLocation = typeof studioLocations.$inferSelect;
export type StudioNudge = typeof studioNudges.$inferSelect;
export type StudioSettings = typeof studioSettings.$inferSelect;
export type SitePublish = typeof sitePublishes.$inferSelect;
export type PlatformUser = typeof platformUsers.$inferSelect;
export type PlatformSession = typeof platformSessions.$inferSelect;
export type PlatformAiUsage = typeof platformAiUsage.$inferSelect;
