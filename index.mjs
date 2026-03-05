import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_qotd.txt',
    HISTORY_FILE: 'qotd_history.json',
    MODELS: [
        "gemini-flash-latest", 
        "gemini-pro-latest", 
        "gemini-2.5-flash", 
        "gemini-1.5-flash"
    ]
};

const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' };
const displayDate = new Date().toLocaleDateString('en-US', options);

/**
 * Robust Wikipedia Image Fetcher
 * This parses the Wiki URL to get the actual "lead" image for the person.
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
        
        if (pageId === "-1") {
            console.log(`No Wikipedia page found for title: ${title}`);
            return null;
        }
        
        return pages[pageId].thumbnail ? pages[pageId].thumbnail.source : null;
    } catch (err) {
        console.error("Wikipedia Image API Error:", err.message);
        return null;
    }
}

async function postToDiscord(quoteData) {
    console.log(`Fetching portrait for: ${quoteData.author}`);
    const wikiThumbnail = await getWikipediaThumbnail(quoteData.sourceUrl);

    const discordPayload = {
        embeds: [{
            title: `Quote of the Day - ${displayDate}`,
            description: `\n# "${quoteData.quote}"\n\n— *${quoteData.author}*\n\n[Learn more about the author](${quoteData.sourceUrl})`,
            color: 0xf1c40f, 
            thumbnail: wikiThumbnail ? { url: wikiThumbnail } : null
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

    // Only show last 40 authors to Gemini to keep prompt small
    const usedAuthors = historyData.slice(0, 40).map(h => h.author);

    const prompt = `Provide an inspiring Quote of the Day from a historical figure.
    JSON ONLY: {
      "quote": "The quote text",
      "author": "Author Name",
      "sourceUrl": "Full Wikipedia URL"
    }
    DO NOT use these authors: ${usedAuthors.join(", ")}`;

    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);

    for (const modelName of CONFIG.MODELS) {
        try {
            console.log(`Attempting Quote generation with ${modelName}...`);
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                generationConfig: { response_mime_type: "application/json" }
            });

            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            
            // Safety Match for JSON
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            const quoteData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);

            if (!quoteData.quote || !quoteData.author) throw new Error("Incomplete JSON received");

            // Save Infinite History
            fs.writeFileSync(CONFIG.SAVE_FILE, `"${quoteData.quote}" — ${quoteData.author}`);
            historyData.unshift(quoteData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData, null, 2));

            await postToDiscord(quoteData);
            console.log("Success! Posted to Discord.");
            return; 

        } catch (err) {
            console.warn(`⚠️ ${modelName} failed: ${err.message}`);
            if (err.message.includes("429")) {
                console.log("Waiting 10s for rate limit...");
                await new Promise(r => setTimeout(r, 10000));
            }
        }
    }
}

main().catch(err => {
    console.error("Critical Failure:", err);
    process.exit(1);
});
