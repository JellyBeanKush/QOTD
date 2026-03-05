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

const displayDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' 
});

/**
 * Fetches the lead image from Wikipedia based on the article title.
 */
async function getWikipediaThumbnail(wikiUrl) {
    try {
        // Extract the title from the URL (e.g., "Martin_Luther_King_Jr.")
        const title = wikiUrl.split('/').pop();
        const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=pageimages&format=json&pithumbsize=400&origin=*`;
        
        const res = await fetch(apiUrl);
        const data = await res.json();
        
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        
        // Return the thumbnail source if it exists
        return pages[pageId].thumbnail ? pages[pageId].thumbnail.source : null;
    } catch (err) {
        console.error("Wiki Image Fetch Failed:", err.message);
        return null;
    }
}

async function postToDiscord(quoteData) {
    const wikiThumbnail = await getWikipediaThumbnail(quoteData.sourceUrl);

    const discordPayload = {
        embeds: [{
            title: `Quote of the Day - ${displayDate}`,
            description: `\n# "${quoteData.quote}"\n\n— *${quoteData.author}*\n\n[Learn more about the author](${quoteData.sourceUrl})`,
            color: 0xf1c40f,
            // Uses the official Wiki photo, fallbacks to null if not found
            thumbnail: wikiThumbnail ? { url: wikiThumbnail } : null
        }]
    };

    await fetch(CONFIG.DISCORD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordPayload)
    });
}

async function main() {
    let historyData = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { historyData = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); } catch (e) {}
    }

    const usedAuthors = historyData.slice(0, 50).map(h => h.author);
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);

    const prompt = `Provide an inspiring Quote of the Day from a historical figure.
    JSON ONLY: {
      "quote": "The quote text",
      "author": "Author Name",
      "sourceUrl": "Full Wikipedia URL"
    }
    DO NOT use these authors: ${usedAuthors.join(", ")}`;

    for (const modelName of CONFIG.MODELS) {
        try {
            console.log(`Attempting: ${modelName}...`);
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                generationConfig: { response_mime_type: "application/json" }
            });

            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            
            // Clean JSON
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            const quoteData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
            
            // File Management
            fs.writeFileSync(CONFIG.SAVE_FILE, `"${quoteData.quote}" — ${quoteData.author}`);
            historyData.unshift(quoteData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData.slice(0, 100), null, 2));

            await postToDiscord(quoteData);
            console.log(`Successfully posted ${quoteData.author} to Discord!`);
            return;

        } catch (err) {
            console.warn(`⚠️ ${modelName} failed: ${err.message}`);
            if (modelName === CONFIG.MODELS[CONFIG.MODELS.length - 1]) process.exit(1);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

main();
