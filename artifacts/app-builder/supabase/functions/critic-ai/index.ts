import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Je bent een strenge kwaliteitsreviewer voor webapplicaties. Je analyseert gegenereerde HTML-apps en geeft een eerlijke beoordeling.

Analyseer de app op:
1. Volledigheid — bevat de app alles wat de gebruiker vroeg?
2. Functionaliteit — werken alle knoppen, formulieren, en interacties?
3. UX/Design — ziet het er professioneel en modern uit?
4. Responsiveness — werkt het op mobiel?
5. Toegankelijkheid — zijn er alt-teksten, goede contrast, etc.?

Geef een score van 0-100 en een lijst van problemen.
Markeer problemen als "critical" (moet gefixt), "warning" (zou beter kunnen), of "suggestion" (nice-to-have).
Stel shouldFix op true als er critical issues zijn.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { html, prompt } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Oorspronkelijk verzoek: "${prompt}"\n\nGegenereerde HTML (eerste 4000 tekens):\n${html.slice(0, 4000)}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_review",
              description: "Dien de kwaliteitsreview in met score en issues.",
              parameters: {
                type: "object",
                properties: {
                  score: { type: "number", description: "Score van 0-100" },
                  issues: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        severity: { type: "string", enum: ["critical", "warning", "suggestion"] },
                        description: { type: "string" },
                        fix: { type: "string" },
                      },
                      required: ["severity", "description", "fix"],
                      additionalProperties: false,
                    },
                  },
                  shouldFix: { type: "boolean", description: "True als er critical issues zijn die gefixt moeten worden" },
                },
                required: ["score", "issues", "shouldFix"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_review" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Credits op" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("Critic AI error:", response.status, t);
      return new Response(JSON.stringify({ error: "Critic AI mislukt" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (toolCall?.function?.arguments) {
      const review = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify(review), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ score: 70, issues: [], shouldFix: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("critic-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Onbekende fout" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
