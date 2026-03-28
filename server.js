const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Serve static files from the current directory (for index.html)
app.use(express.static(__dirname));

app.post('/api/analyze', async (req, res) => {
    try {
        const { input } = req.body;
        const API_KEY = process.env.GEMINI_API_KEY;

        if (!API_KEY) {
            return res.status(500).json({ error: "Server missing GEMINI_API_KEY environment variable. If deploying to Cloud Run, make sure it is added in the secret manager or as an env var." });
        }

        const payload = {
            contents: [{ parts: [{ text: input }] }],
            systemInstruction: {
                parts: [{ text: "You are CrisisLens, an emergency intelligence system. Convert messy unstructured input into a structured JSON action brief. Always respond ONLY with this JSON and nothing else:\n{\n  \"severity\": \"CRITICAL\" | \"HIGH\" | \"MEDIUM\" | \"LOW\",\n  \"incident_type\": \"string\",\n  \"summary\": \"one sentence plain language for a first responder\",\n  \"location_raw\": \"extracted location text\",\n  \"location_address\": \"best address guess\",\n  \"time_sensitivity\": \"seconds\" | \"minutes\" | \"hours\",\n  \"key_facts\": [\"array of 3 facts\"],\n  \"recommended_action\": \"single most important action\",\n  \"dispatch_template\": \"under 160 chars SMS-ready message\",\n  \"confidence\": 0.0 to 1.0\n}\nNever add explanation. Never add markdown. Only valid JSON." }]
            },
            generationConfig: {
                responseMimeType: "application/json"
            }
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        let resultText = data.candidates[0].content.parts[0].text;

        // Cleanup in case of stray markdown despite prompt
        if (resultText.startsWith("```json")) {
            resultText = resultText.replace(/```json/g, "").replace(/```/g, "").trim();
        }

        const parsed = JSON.parse(resultText);
        res.json(parsed);

    } catch (err) {
        console.error("API failed:", err);
        res.status(500).json({ error: err.message || "Failed to analyze input." });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
