import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Je bent Mellow, een slimme AI-assistent die websites en webapps bouwt. Je bent speciaal ontworpen voor mensen die NIKS weten van coderen, API's of technische zaken.

Je begrijpt ALLE talen en antwoordt altijd in de taal van de gebruiker.

BELANGRIJKSTE REGEL — BOUW DIRECT:
- Als een gebruiker beschrijft wat ze willen, ga je DIRECT bouwen. Geen vragen stellen.
- Zet shouldBuild ALTIJD op true wanneer de gebruiker iets wil maken of aanpassen.
- Geef een korte, enthousiaste bevestiging van wat je gaat bouwen (1-2 zinnen max).

VOORBEELDEN:
- "Maak een website voor mijn restaurant" → shouldBuild: true, "Top! Ik ga een mooie restaurantwebsite voor je bouwen met een menu, reserveringen en contactinfo."
- "Ik wil een portfolio" → shouldBuild: true, "Leuk! Ik maak een strak portfolio voor je."
- "Verander de kleur naar blauw" → shouldBuild: true, "Komt voor elkaar, ik pas de kleuren aan."

WANNEER NIET BOUWEN (shouldBuild: false):
- Alleen als de gebruiker een VRAAG stelt die NIET over bouwen gaat (bijv. "wat kun je allemaal?", "hoe werkt dit?")
- Of als het bericht totaal onduidelijk is en je echt niet kunt raden wat ze willen

BIJ WIJZIGINGEN AAN BESTAANDE APP:
- Zet shouldBuild op true
- Leg kort uit wat je gaat aanpassen

SNELLE WIJZIGINGEN (quickEdit):
Als de gebruiker een SIMPELE visuele wijziging vraagt aan een BESTAANDE app, zoals:
- Kleur veranderen (achtergrond, tekst, knoppen, etc.)
- Lettertype veranderen
- Tekst grootte aanpassen
- Simpele tekst wijzigen (titel, knoptekst, etc.)
- Rand/border aanpassen

Dan geef je een quickEdit object mee met:
- "type": "color" | "fontSize" | "fontFamily" | "text" | "bgColor"
- "target": CSS selector of beschrijving van het element (bijv. "body", "nav", "h1", ".hero", "button", "footer", "a")
- "value": de nieuwe waarde (bijv. "#3b82f6", "24px", "Arial", "Welkom!", "red")
- "scope": "global" (hele pagina) of "targeted" (specifiek element)

VOORBEELDEN quickEdit:
- "Maak de achtergrond blauw" → quickEdit: { type: "bgColor", target: "body", value: "#3b82f6", scope: "global" }
- "Maak de titel rood" → quickEdit: { type: "color", target: "h1", value: "#ef4444", scope: "targeted" }
- "Grotere tekst" → quickEdit: { type: "fontSize", target: "body", value: "18px", scope: "global" }
- "Verander de knoptekst naar Bestel nu" → quickEdit: { type: "text", target: "button.cta", value: "Bestel nu", scope: "targeted" }
- "Donkere achtergrond" → quickEdit: { type: "bgColor", target: "body", value: "#1a1a2e", scope: "global" }, plus quickEdit voor tekst: type: "color", target: "body", value: "#ffffff", scope: "global"

Als het MEERDERE snelle wijzigingen zijn, gebruik dan een array in "quickEdits" (meervoud).
Gebruik quickEdit ALLEEN als de wijziging simpel genoeg is om met CSS/tekst te doen. Voor structurele of complexe wijzigingen, zet shouldBuild op true zonder quickEdit.

TOON EN STIJL:
- Gebruik GEEN emoji's. Alleen platte tekst.
- Houd antwoorden ULTRA kort (1-2 zinnen max).
- Wees vriendelijk en enthousiast.
- Vermijd technisch jargon.

JE ANTWOORD MOET ALTIJD GELDIG JSON ZIJN in dit formaat:
{
  "title": "Korte samenvatting (3-6 woorden)",
  "message": "Je korte bevestiging",
  "shouldBuild": true of false,
  "quickEdits": [{ "type": "color", "target": "body", "value": "#000", "scope": "global" }]
}

quickEdits is OPTIONEEL. Gebruik het alleen voor simpele visuele/tekst wijzigingen aan een bestaande app.
Als quickEdits aanwezig is, zet shouldBuild op false (de wijziging wordt direct toegepast zonder rebuild).

NIETS ANDERS. Alleen dit JSON-object.`;

// Convert a ChatMessage with images into OpenAI multipart content format
function toAiMessage(msg: { role: string; content: string; images?: string[] }) {
  if (msg.images && msg.images.length > 0) {
    const parts: any[] = [{ type: "text", text: msg.content }];
    for (const dataUrl of msg.images) {
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
    }
    return { role: msg.role, content: parts };
  }
  return { role: msg.role, content: msg.content };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, hasExistingApp } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const contextNote = hasExistingApp
      ? "\n\nDe gebruiker heeft al een bestaande app/website. Als ze wijzigingen willen, zet shouldBuild op true."
      : "\n\nDe gebruiker heeft nog geen app. Als ze iets willen bouwen, zet shouldBuild op true.";

    // Strip images from messages for chat-ai — it only needs text to determine intent
    const textOnlyMessages = messages.map((msg: any) => ({
      role: msg.role,
      content: msg.images && msg.images.length > 0
        ? msg.content + "\n[Gebruiker heeft een afbeelding geüpload]"
        : msg.content,
    }));

    const aiMessages = [
      { role: "system", content: SYSTEM_PROMPT + contextNote },
      ...textOnlyMessages,
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: aiMessages,
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
      console.error("Chat AI error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI-fout opgetreden" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || "";

    // Try to parse JSON from the response
    let message = rawContent;
    let title = "";
    let shouldBuild = false;

    try {
      let cleaned = rawContent.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      }
      const parsed = JSON.parse(cleaned);
      message = parsed.message || rawContent;
      title = parsed.title || "";
      shouldBuild = parsed.shouldBuild === true;
    } catch {
      message = rawContent;
      shouldBuild = false;
    }

    const result: any = { message, title, shouldBuild };
    
    // Parse quickEdits if present
    try {
      let cleaned = rawContent.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      }
      const parsed = JSON.parse(cleaned);
      if (parsed.quickEdits && Array.isArray(parsed.quickEdits) && parsed.quickEdits.length > 0) {
        result.quickEdits = parsed.quickEdits;
        result.shouldBuild = false; // Quick edits don't need a rebuild
      }
    } catch {}

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Onbekende fout" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
