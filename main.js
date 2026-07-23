import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Setup paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    if (req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'))) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});
// Serve the frontend files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// 1. Initialize the client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 2. Create the API Endpoint
app.post('/api/generate', async (req, res) => {
    const { customFilenameBase, userRequest } = req.body;

    if (!customFilenameBase || !userRequest) {
        return res.status(400).json({ error: "Missing filename or prompt." });
    }

    try {
        console.log(`\nReceived request to generate: ${customFilenameBase}`);
        
        // 3. Define a strict JSON prompt
        const prompt = `${userRequest}\n\n` +
            "CRITICAL INSTRUCTIONS:\n" +
            "1. Analyze the request and determine the most appropriate programming language and file extension.\n" +
            "2. Output ONLY a raw JSON object. Do not include markdown code blocks (like ```json), greetings, or explanations.\n" +
            "3. The JSON object must contain exactly two keys: 'extension' and 'code'.\n" +
            "4. The 'extension' value must include the leading dot (e.g., '.py', '.js', '.cpp', '.jsx').\n" +
            "5. The 'code' value must contain the raw, executable code.\n" +
            "Example Output:\n" +
            '{"extension": ".js", "code": "console.log(\'Hello\');"}';

        // 4. Get the response from Gemini
        const response = await ai.models.generateContent({
            model: "gemini-3.6-flash", 
            contents: prompt,
        });

        // 5. Clean up the response to ensure it's pure JSON
        let cleanText = response.text.trim();
        if (cleanText.startsWith("```")) {
            const lines = cleanText.split("\n");
            cleanText = lines.slice(1, -1).join("\n").trim();
        }

        // 6. Parse the JSON and extract the data
        const data = JSON.parse(cleanText);
        const extension = data.extension || ".txt";
        const codeContent = data.code || "";

        // 7. Define the folder and file path
        const folderName = path.join(__dirname, "tmp");
        if (!fs.existsSync(folderName)) {
            fs.mkdirSync(folderName, { recursive: true });
        }

        const finalFilename = customFilenameBase + extension;
        const filePath = path.join(folderName, finalFilename);

        // 8. Save the file
        fs.writeFileSync(filePath, codeContent, 'utf-8');
        
        console.log(`Success! Saved to ${filePath}`);

        // Send success back to the frontend
        res.json({
            success: true,
            message: `Code saved to ${filePath}`,
            extension: extension,
            code: codeContent,
            filename: finalFilename // Passing this back so the frontend knows what to request
        });

    } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ error: error.message || "Failed to generate code." });
    }
});

// 9. Create the Download Endpoint
app.get('/api/download/:filename', (req, res) => {
    // path.basename sanitizes the input to prevent directory traversal
    const filename = path.basename(req.params.filename);
    const filePath = path.join(__dirname, 'tmp', filename);

    // Check if the file actually exists before downloading
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found." });
    }

    // res.download sets the headers to prompt a file download in the browser
    res.download(filePath, filename, (err) => {
        if (err) {
            console.error("Error downloading file:", err);
            // Only send error response if headers haven't been sent yet
            if (!res.headersSent) {
                res.status(500).json({ error: "Failed to download file." });
            }
        }
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Backend running! API is at http://localhost:${port}/api/generate`);
    console.log(`Downloads available at http://localhost:${port}/api/download/<filename>`);
    console.log(`Frontend will be available at http://localhost:${port} once you run the Python script.`);
});