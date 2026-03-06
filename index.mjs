import { GoogleGenAI } from "@google/genai";
import fetch from 'node-fetch';
import fs from 'fs';

/**
 * CONFIGURATION
 * Prioritizing Gemini 3.1 Flash-Lite (Released March 3, 2026)
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
 * Wikipedia Thumbnail Fetcher
 * Scrapes the lead portrait for the author's Wikipedia page.
 */
async function getWikipediaThumbnail(wikiUrl) {
    try {
        if (!wikiUrl || !wikiUrl.includes('wikipedia.org')) return null;
        
        const title = wikiUrl.split('/').pop();
        const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=pageimages&format=json&pithumbsize=400&origin=*`;
        
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error(`Wiki API error: ${res.statusText}`);
        
        const data = await res.json();
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        
        if (pageId === "-1") return null;
        return pages[pageId].thumbnail ? pages[pageId].thumbnail.source : null;
    } catch (err) {
        console.error("[Wiki Error]:", err.message);
        return null;
    }
}

/**
 * Discord Webhook Poster
 * Styles: Heading 3 for quote, "Learn more" link, no footer.
 */
async function postToDiscord(quoteData) {
    console.log(`[Discord] Preparing post for: ${quoteData.author}`);
    const wikiThumbnail = await getWikipediaThumbnail(quoteData.sourceUrl);

    const discordPayload = {
        embeds: [{
            title: `Quote of the Day — ${displayDate}`,
            // ### used for smaller, non-screaming bold text
            description: `### "${quoteData.quote}"\n\n— **${quoteData.author}**\n\n[Learn more](${quoteData.sourceUrl})`,
            color: 0xf1c40f, // Gold
            thumbnail: wikiThumbnail ? { url: wikiThumbnail } : null
            // Footer specifically removed as requested
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

    // 1. Load History to avoid repeat authors
    let historyData = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { 
            historyData = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); 
        } catch (e) {
            console.warn("[History] Resetting corrupted history file.");
        }
    }

    const usedAuthors = historyData.slice(0, 50).map(h => h.author);
    const prompt = `Provide an inspiring Quote of the Day from a historical figure.
    Return ONLY a raw JSON object with this structure:
    {
      "quote": "The quote text",
      "author": "Author Name",
      "sourceUrl": "Full Wikipedia URL"
    }
    DO NOT use these authors: ${usedAuthors.join(", ")}`;

    // 2. Initialize the modern Google Gen AI client
    const client = new GoogleGenAI({ apiKey: CONFIG.GEMINI_KEY });

    // 3. Fallback Model Loop
    for (const modelName of CONFIG.MODELS) {
        try {
            console.log(`[Model] Attempting with ${modelName}...`);
            
            const result = await client.models.generateContent({
                model: modelName,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    // Configures Gemini 3 models for low-latency speed
                    thinkingConfig: { 
                        thinkingLevel: "MINIMAL" 
                    }
                }
            });

            const responseText = result.text; 
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON found in response.");

            const quoteData = JSON.parse(jsonMatch[0]);
            if (!quoteData.quote || !quoteData.author) throw new Error("Incomplete JSON.");

            // 4. Save Locally
            fs.writeFileSync(CONFIG.SAVE_FILE, `"${quoteData.quote}" — ${quoteData.author}`);
            historyData.unshift(quoteData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData, null, 2));

            // 5. Final Step: Post to Discord
            await postToDiscord(quoteData);

            console.log("--- QOTD Process Complete ---");
            return; 

        } catch (err) {
            // Logs 503/429 errors and moves to the next model in CONFIG.MODELS
            console.warn(`⚠️ ${modelName} failed: ${err.message}`);
        }
    }

    // 6. If all models fail, exit with error so Git Actions turns RED
    console.error("CRITICAL: All models failed.");
    process.exit(1);
}

main();
