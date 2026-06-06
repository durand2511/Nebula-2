/**
 * Memory — Persistent context storage for the agent.
 * Stores user preferences, past app structures, and learnings.
 */

const MEMORY_KEY = "mellow_agent_memory";

export interface AppMemoryEntry {
  id: string;
  timestamp: number;
  userIdea: string;
  appName: string;
  screens: string[];
  features: string[];
  score: number;
  iterations: number;
}

export interface UserPreferences {
  preferredColors: string[];
  preferredStyle: "modern" | "minimal" | "bold" | "classic";
  language: string;
  industry: string[];
}

export interface AgentMemory {
  apps: AppMemoryEntry[];
  preferences: UserPreferences;
  totalAppsBuilt: number;
  commonPatterns: Record<string, number>;
}

const DEFAULT_MEMORY: AgentMemory = {
  apps: [],
  preferences: {
    preferredColors: [],
    preferredStyle: "modern",
    language: "nl",
    industry: [],
  },
  totalAppsBuilt: 0,
  commonPatterns: {},
};

/** Load memory from localStorage */
export function loadMemory(): AgentMemory {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return { ...DEFAULT_MEMORY };
    return { ...DEFAULT_MEMORY, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_MEMORY };
  }
}

/** Save memory to localStorage */
export function saveMemory(memory: AgentMemory): void {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    console.warn("Memory save failed");
  }
}

/** Record a completed app build */
export function rememberApp(
  memory: AgentMemory,
  entry: Omit<AppMemoryEntry, "id" | "timestamp">,
): AgentMemory {
  const newEntry: AppMemoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };

  const updated: AgentMemory = {
    ...memory,
    apps: [newEntry, ...memory.apps].slice(0, 50),
    totalAppsBuilt: memory.totalAppsBuilt + 1,
  };

  // Track common patterns
  for (const feature of entry.features) {
    const key = feature.toLowerCase();
    updated.commonPatterns[key] = (updated.commonPatterns[key] || 0) + 1;
  }

  saveMemory(updated);
  return updated;
}

/** Update user preferences based on observed patterns */
export function updatePreferences(
  memory: AgentMemory,
  updates: Partial<UserPreferences>,
): AgentMemory {
  const updated: AgentMemory = {
    ...memory,
    preferences: { ...memory.preferences, ...updates },
  };
  saveMemory(updated);
  return updated;
}

/** Detect industry from user prompt */
export function detectIndustry(prompt: string): string[] {
  const industries: string[] = [];
  const lower = prompt.toLowerCase();

  const industryKeywords: Record<string, string[]> = {
    restaurant: ["restaurant", "eten", "menu", "reserv", "food", "keuken"],
    fitness: ["fitness", "sport", "gym", "training", "workout", "oefening"],
    ecommerce: ["winkel", "shop", "product", "bestel", "kopen", "webshop"],
    healthcare: ["gezondheid", "dokter", "afspraak", "patient", "kliniek"],
    education: ["school", "cursus", "leren", "student", "les", "onderwijs"],
    realestate: ["woning", "huis", "makelaar", "vastgoed", "huren", "kopen"],
    beauty: ["salon", "kapper", "beauty", "nagel", "haar", "schoonheid"],
    portfolio: ["portfolio", "freelanc", "cv", "werk", "project"],
  };

  for (const [industry, keywords] of Object.entries(industryKeywords)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      industries.push(industry);
    }
  }

  return industries;
}

/** Get context hints from memory for better generation */
export function getMemoryContext(memory: AgentMemory, prompt: string): string {
  const hints: string[] = [];
  const industries = detectIndustry(prompt);

  if (industries.length > 0) {
    // Find similar past apps
    const similar = memory.apps.filter((app) =>
      industries.some((ind) =>
        app.features.some((f) => f.toLowerCase().includes(ind)),
      ),
    );
    if (similar.length > 0) {
      const best = similar.reduce((a, b) => (a.score > b.score ? a : b));
      hints.push(
        `Eerder succesvol gebouwd: "${best.appName}" (score: ${best.score}/10)`,
      );
    }
  }

  // Add common patterns
  const topPatterns = Object.entries(memory.commonPatterns)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([k]) => k);

  if (topPatterns.length > 0) {
    hints.push(`Populaire features: ${topPatterns.join(", ")}`);
  }

  if (memory.preferences.preferredStyle !== "modern") {
    hints.push(`Voorkeur stijl: ${memory.preferences.preferredStyle}`);
  }

  return hints.join("\n");
}

/** Clear all memory */
export function clearMemory(): void {
  localStorage.removeItem(MEMORY_KEY);
}
