import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

// Configuration
const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_qotd.txt',
    HISTORY_FILE: 'qotd_history.json',
    // Ordered by preference: 3.1 Lite is fastest/newest
    MODELS: [
        "gemini-3.1-flash-lite-preview", 
        "gemini-3-flash-preview", 
        "gemini-1.5-flash"
    ]
};

const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' };
const displayDate = new Date().toLocaleDateString('en-US', options);

/**
 * Robust Wikipedia Image Fetcher
 */
async function getWikipediaThumbnail(wikiUrl) {
    try {
        if (!wikiUrl || !wikiUrl.includes('wikipedia.org')) return null;
        const title = wikiUrl.split('/').pop();
        const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=pageimages&format=json&pithumbsize=400&origin=*`;
        
        const res = await fetch(apiUrl);
        const data = await res.json();
        
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        
        if (pageId === "-1") return null;
        return pages[pageId].thumbnail ? pages[pageId].thumbnail.source : null;
    } catch (err) {
        console.error("Wikipedia Image API Error:", err.message);
        return null;
    }
}

/**
 * Posts the formatted embed to Discord
 */
async function postToDiscord(quoteData) {
    console.log(`Fetching portrait for: ${quoteData.author}`);
    const wikiThumbnail = await getWikipediaThumbnail(quoteData.sourceUrl);

    const discordPayload = {
        embeds: [{
            title: `Quote of the Day - ${displayDate}`,
            description: `\n# "${quoteData.quote}"\n\n— *${quoteData.author}*\n\n[Learn more about the author](${quoteData.sourceUrl})`,
            color: 0xf1c40f, // Gold color
            thumbnail: wikiThumbnail ? { url: wikiThumbnail } : null,
            footer: { text: "Generated via Gemini 3.1 Flash-Lite" }
        }]
    };

    const res = await fetch(CONFIG.DISCORD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordPayload)
    });

    if (!res.ok) {
        const errorText = await res.text();
        console.error("Discord Webhook Error:", errorText);
    }
}

async function main() {
    let historyData = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { 
            historyData = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); 
        } catch (e) {
            console.error("History file corrupted, starting fresh.");
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

    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);

    for (const modelName of CONFIG.MODELS) {
        try {
            console.log(`Attempting Quote generation with ${modelName}...`);
            
            // Explicitly use v1beta to support thinkingConfig and latest model names
            const model = genAI.getGenerativeModel(
                { model: modelName },
                { apiVersion: 'v1beta' }
            );

            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { 
                    response_mime_type: "application/json",
                    // Use minimal thinking for speed on low-complexity tasks
                    thinkingConfig: {
                        includeThoughts: false,
                        thinkingLevel: "MINIMAL" 
                    }
                }
            });

            const responseText = result.response.text();
            
            // Extract JSON from potential Markdown blocks
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            const quoteData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);

            if (!quoteData.quote || !quoteData.author) throw new Error("Incomplete JSON");

            // Save history
            fs.writeFileSync(CONFIG.SAVE_FILE, `"${quoteData.quote}" — ${quoteData.author}`);
            historyData.unshift(quoteData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData, null, 2));

            await postToDiscord(quoteData);
            console.log("Success! Posted to Discord.");
            return; 

        } catch (err) {
            console.warn(`⚠️ ${modelName} failed: ${err.message}`);
            // Wait before trying the next model if rate limited
            if (err.message.includes("429")) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }
}

main().catch(err => {
    console.error("Critical Failure:", err);
    process.exit(1);
});
