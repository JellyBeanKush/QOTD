import { GoogleGenAI } from "@google/genai";
import fetch from 'node-fetch';
import fs from 'fs';

/**
 * CONFIGURATION & MODELS
 * Prioritizing Gemini 3.1 Flash-Lite (Released March 2026)
 */
const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_qotd.txt',
    HISTORY_FILE: 'qotd_history.json',
    MODELS: [
        "gemini-3.1-flash-lite-preview", 
        "gemini-3-flash-preview", 
        "gemini-1.5-flash"
    ]
};

const dateOptions = { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric', 
    timeZone: 'America/Los_Angeles' 
};
const displayDate = new Date().toLocaleDateString('en-US', dateOptions);

/**
 * Robust Wikipedia Image Fetcher
 * Scrapes the lead thumbnail for the author's Wikipedia page.
 */
async function getWikipediaThumbnail(wikiUrl) {
    try {
        if (!wikiUrl || !wikiUrl.includes('wikipedia.org')) return null;
        
        // Extract the page title from the URL
        const title = wikiUrl.split('/').pop();
        const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=pageimages&format=json&pithumbsize=400&origin=*`;
        
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error(`Wiki API error: ${res.statusText}`);
        
        const data = await res.json();
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        
        if (pageId === "-1") {
            console.log(`[Wiki] No page found for: ${title}`);
            return null;
        }
        
        return pages[pageId].thumbnail ? pages[pageId].thumbnail.source : null;
    } catch (err) {
        console.error("[Wiki Error]:", err.message);
        return null;
    }
}

/**
 * Discord Webhook Poster
 * Sends a stylized embed with author portrait.
 */
async function postToDiscord(quoteData) {
    console.log(`[Discord] Preparing post for: ${quoteData.author}`);
    const wikiThumbnail = await getWikipediaThumbnail(quoteData.sourceUrl);

    const discordPayload = {
        embeds: [{
            title: `Quote of the Day — ${displayDate}`,
            description: `# "${quoteData.quote}"\n\n— **${quoteData.author}**\n\n[Author Biography](${quoteData.sourceUrl})`,
            color: 0xf1c40f, // Gold
            thumbnail: wikiThumbnail ? { url: wikiThumbnail } : null,
            footer: { 
                text: `Generated via Gemini 3.1 Flash-Lite` 
            }
        }]
    };

    const res = await fetch(CONFIG.DISCORD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordPayload)
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Discord Webhook Failed: ${errorText}`);
    }
    console.log("[Discord] Successfully posted.");
}

/**
 * Main Execution Loop
 */
async function main() {
    console.log("--- Starting QOTD Generation ---");

    // 1. Load History
    let historyData = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { 
            historyData = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); 
        } catch (e) {
            console.warn("[History] Corrupted file, starting fresh.");
        }
    }

    // 2. Prep Prompt (Avoid repeats)
    const usedAuthors = historyData.slice(0, 50).map(h => h.author);
    const prompt = `Provide an inspiring and deeply insightful Quote of the Day from a historical figure.
    Return ONLY a raw JSON object:
    {
      "quote": "The quote text",
      "author": "Author Name",
      "sourceUrl": "Full Wikipedia URL"
    }
    STRICTLY AVOID these authors: ${usedAuthors.join(", ")}`;

    // 3. Initialize the New 2026 SDK
    // This SDK automatically handles the v1beta endpoint and Gemini 3 models
    const client = new GoogleGenAI({ apiKey: CONFIG.GEMINI_KEY });

    // 4. Try Models in Order
    for (const modelName of CONFIG.MODELS) {
        try {
            console.log(`[Model] Attempting with ${modelName}...`);
            
            const result = await client.models.generateContent({
                model: modelName,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    // Gemini 3 Flash and 3.1 Lite support thinkingLevel
                    thinkingConfig: { 
                        thinkingLevel: "MINIMAL" 
                    }
                }
            });

            // Extract text from the new SDK response structure
            const responseText = result.text; 
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON found in model response.");

            const quoteData = JSON.parse(jsonMatch[0]);

            if (!quoteData.quote || !quoteData.author) {
                throw new Error("JSON missing required fields.");
            }

            // 5. Save Data Locally
            fs.writeFileSync(CONFIG.SAVE_FILE, `"${quoteData.quote}" — ${quoteData.author}`);
            historyData.unshift(quoteData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData, null, 2));

            // 6. Post to Discord
            await postToDiscord(quoteData);

            console.log("--- QOTD Process Complete ---");
            return; // Success exit

        } catch (err) {
            console.warn(`[Error] ${modelName} failed: ${err.message}`);
            // Wait slightly if we hit a rate limit (429)
            if (err.message.includes("429")) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    // 7. Critical Failure - Exit with code 1 so GitHub Action turns RED ❌
    console.error("CRITICAL: All models failed to generate a quote.");
    process.exit(1);
}

// Start the bot
main();
