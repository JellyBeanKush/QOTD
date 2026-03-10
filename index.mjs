import { GoogleGenAI } from "@google/genai";
import fetch from 'node-fetch';
import fs from 'fs';

/**
 * CONFIGURATION
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
    ],
    MAX_RETRIES: 3
};

const dateOptions = { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric', 
    timeZone: 'America/Los_Angeles' 
};
const displayDate = new Date().toLocaleDateString('en-US', dateOptions);

async function verifyUrl(url) {
    try {
        const res = await fetch(url, { method: 'HEAD' });
        return res.ok;
    } catch { return false; }
}

async function getWikipediaThumbnail(wikiUrl) {
    try {
        if (!wikiUrl || !wikiUrl.includes('wikipedia.org')) return null;
        const title = wikiUrl.split('/').pop();
        const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=pageimages&format=json&pithumbsize=400&origin=*`;
        const res = await fetch(apiUrl);
        const data = await res.json();
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        return pageId !== "-1" && pages[pageId].thumbnail ? pages[pageId].thumbnail.source : null;
    } catch { return null; }
}

async function postToDiscord(quoteData) {
    console.log(`[Discord] Posting: ${quoteData.author}`);
    const wikiThumbnail = await getWikipediaThumbnail(quoteData.sourceUrl);

    // FIX: Remove parentheses from context text to avoid breaking Discord Markdown
    const cleanContext = quoteData.context.replace(/[()]/g, '');
    
    // FIX: Wrap URL in < > to ensure Discord treats it as a direct link, not a search
    const contextLink = `[*${cleanContext}*](<${quoteData.quoteUrl}>)`;

    const discordPayload = {
        embeds: [{
            title: `Quote of the Day — ${displayDate}`,
            description: `### "${quoteData.quote}"\n\n— **${quoteData.author}**\n${contextLink}\n\n[About the Author](<${quoteData.sourceUrl}>)`,
            color: 0xf1c40f,
            thumbnail: wikiThumbnail ? { url: wikiThumbnail } : null
        }]
    };

    const res = await fetch(CONFIG.DISCORD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordPayload)
    });
    if (!res.ok) throw new Error(`Discord Error: ${await res.text()}`);
}

async function main() {
    console.log("--- Starting Bulletproof QOTD Generation ---");

    let historyData = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { historyData = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); } 
        catch { console.warn("[History] Resetting file."); }
    }

    const usedAuthors = historyData.slice(0, 50).map(h => h.author);
    const usedQuotes = historyData.slice(0, 50).map(h => h.quote.toLowerCase().trim());

    const prompt = `Provide a famous, verified Quote of the Day.
    Return ONLY raw JSON:
    {
      "quote": "The exact quote text",
      "author": "Full Name",
      "sourceUrl": "Author's Wikipedia Bio URL",
      "quoteUrl": "A specific URL verifying this exact quote (e.g., Wikiquote or a speech transcript)",
      "context": "Short name of the source (e.g. 'The Meditations', 'Gettysburg Address')"
    }
    
    RULES:
    - DO NOT repeat these authors: ${usedAuthors.join(", ")}
    - DO NOT repeat these quotes: ${usedQuotes.join(" | ")}`;

    const client = new GoogleGenAI({ apiKey: CONFIG.GEMINI_KEY });

    for (const modelName of CONFIG.MODELS) {
        for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
            try {
                console.log(`[Model] ${modelName} (Attempt ${attempt})...`);
                const result = await client.models.generateContent({
                    model: modelName,
                    contents: prompt,
                    config: { responseMimeType: "application/json" }
                });

                const quoteData = JSON.parse(result.text);

                const authorOk = await verifyUrl(quoteData.sourceUrl);
                const quoteOk = await verifyUrl(quoteData.quoteUrl);

                if (!authorOk || !quoteOk) {
                    console.warn(`[Reject] Broken links. Retrying...`);
                    continue;
                }

                if (usedQuotes.includes(quoteData.quote.toLowerCase().trim())) {
                    console.warn(`[Reject] Duplicate quote. Retrying...`);
                    continue;
                }

                fs.writeFileSync(CONFIG.SAVE_FILE, `"${quoteData.quote}" — ${quoteData.author}`);
                historyData.unshift(quoteData);
                fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(historyData.slice(0, 100), null, 2));

                await postToDiscord(quoteData);
                console.log("--- QOTD Complete ---");
                return;

            } catch (err) { console.warn(`⚠️ Error: ${err.message}`); }
        }
    }
    process.exit(1);
}

main();
