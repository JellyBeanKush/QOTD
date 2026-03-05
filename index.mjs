import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_qotd.txt',
    HISTORY_FILE: 'qotd_history.json',
    MODELS: ["gemini-flash-latest", "gemini-pro-latest", "gemini-2.5-flash", "gemini-1.5-flash"]
};

const displayDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' 
});

async function getWikipediaThumbnail(wikiUrl) {
    try {
        const title = wikiUrl.split('/').pop();
        const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=pageimages&format=json&pithumbsize=400&origin=*`;
        const res = await fetch(apiUrl);
        const data = await res.json();
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        return pages[pageId].thumbnail ? pages[pageId].thumbnail.source : null;
    } catch (err) { return null; }
}

async function main() {
    let history = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { history = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); } catch (e) { history = []; }
    }

    const usedAuthors = history.slice(0, 40).map(h => h.author).join(", ");
    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);

    const prompt = `Provide an inspiring Quote of the Day from a historical figure. 
    JSON ONLY: {
      "quote": "The quote text",
      "author": "Author Name",
      "sourceUrl": "Full Wikipedia URL"
    }
    DO NOT use these authors: ${usedAuthors}`;

    for (const modelName of CONFIG.MODELS) {
        try {
            console.log(`Attempting Quote with ${modelName}...`);
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                generationConfig: { response_mime_type: "application/json" }
            });

            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            const quoteData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);

            const wikiThumbnail = await getWikipediaThumbnail(quoteData.sourceUrl);

            // Save Infinite History
            fs.writeFileSync(CONFIG.SAVE_FILE, `"${quoteData.quote}" — ${quoteData.author}`);
            history.unshift(quoteData);
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(history, null, 2));

            const payload = {
                embeds: [{
                    title: `Quote of the Day - ${displayDate}`,
                    description: `\n# "${quoteData.quote}"\n\n— *${quoteData.author}*\n\n[Learn more about the author](${quoteData.sourceUrl})`,
                    color: 0xf1c40f,
                    thumbnail: wikiThumbnail ? { url: wikiThumbnail } : null
                }]
            };

            await fetch(CONFIG.DISCORD_URL, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(payload) 
            });
            console.log("Quote Successful!");
            return;
        } catch (err) {
            console.warn(`Fail: ${err.message}`);
            if (err.message.includes("429")) await new Promise(r => setTimeout(r, 10000));
        }
    }
}
main();
