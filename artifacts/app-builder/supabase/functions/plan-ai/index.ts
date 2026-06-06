import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Je bent Mellow, een slimme AI-assistent die websites en webapps bouwt en debugt. Je spreekt Nederlands.

Wanneer een gebruiker een probleem meldt of vastloopt, analyseer je de situatie en maak je een helder plan om het op te lossen.
Je kijkt naar:
- Wat het probleem waarschijnlijk is (diagnose)
- Welke stappen nodig zijn om het te fixen
- Mogelijke oorzaken en oplossingen
- Hoe je verifieert dat het werkt na de fix

Als het een nieuw bouwverzoek is (geen probleem), maak dan een bouwplan.

Houd het plan concreet en uitvoerbaar. Maximaal 6 stappen. Elke stap moet een duidelijke actie beschrijven.
Geef een korte samenvatting (1-2 zinnen) van het probleem en de aanpak.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, hasExistingApp, currentHtml } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const contextNote = hasExistingApp
      ? "\n\nDe gebruiker heeft een bestaande app. Analyseer het probleem in context van hun huidige app en stel een fix-plan voor."
      : "\n\nDe gebruiker heeft nog geen app. Maak een bouwplan.";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT + contextNote },
          ...(currentHtml ? [{ role: "user" as const, content: `Dit is de huidige HTML van de app:\n\`\`\`html\n${currentHtml.slice(0, 3000)}\n\`\`\`` }] : []),
          { role: "user", content: `Analyseer dit en maak een plan: ${prompt}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "create_plan",
              description: "Maak een gestructureerd bouwplan met stappen en samenvatting.",
              parameters: {
                type: "object",
                properties: {
                  summary: {
                    type: "string",
                    description: "Korte samenvatting van wat er gebouwd/aangepast gaat worden (1-2 zinnen)",
                  },
                  steps: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string", description: "Korte titel van de stap" },
                        description: { type: "string", description: "Uitleg wat er in deze stap gebeurt" },
                      },
                      required: ["title", "description"],
                      additionalProperties: false,
                    },
                    description: "Array van 3-6 concrete stappen",
                  },
                },
                required: ["summary", "steps"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "create_plan" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Te veel verzoeken. Probeer het even later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI-tegoed op." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("Plan AI error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI-fout opgetreden" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    
    // Extract tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const plan = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify(plan), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fallback
    return new Response(JSON.stringify({
      summary: "Plan kon niet worden gegenereerd.",
      steps: [{ title: "Opnieuw proberen", description: "Probeer je verzoek opnieuw te formuleren." }],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("plan-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Onbekende fout" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
