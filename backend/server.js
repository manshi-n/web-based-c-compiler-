require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Groq = require("groq-sdk");

const app = express();

/* ---------- MIDDLEWARE ---------- */
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/* ---------- GROQ ---------- */
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

/* ---------- TEMP DIR ---------- */
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

/* ---------- AI CACHE (IMPORTANT) ---------- */
const cache = new Map();

function getCacheKey(code) {
    return Buffer.from(code).toString("base64").slice(0, 60);
}

/* ---------- CLEAN CODE ---------- */
function cleanCode(code) {
    return code ? code.replace(/```[a-z]*|```/g, "").trim() : "";
}

/* ---------- COMPLEXITY ---------- */
function estimateComplexity(code) {
    const loops = (code.match(/\b(for|while)\b/g) || []).length;

    if (/for[\s\S]*for|while[\s\S]*while/.test(code)) return "O(n^2)";
    if (loops === 1) return "O(n)";
    if (loops === 0) return "O(1)";
    if (loops >= 3) return "O(n^k)";

    return "O(n)";
}

/* ---------- SAFETY ---------- */
function safetyScore(code) {
    let score = 100;

    if (/gets\s*\(/.test(code)) score -= 40;
    if (/strcpy\s*\(/.test(code)) score -= 25;
    if (/scanf\s*\(/.test(code)) score -= 10;
    if (/\/\s*0/.test(code)) score -= 20;

    return Math.max(score, 0) + "%";
}

/* ---------- AI ---------- */
async function getAISuggestion(code, compileError, runtimeError) {

    const prompt = `
Fix and optimize C code.

CODE:
${code}

ERROR:
${compileError || runtimeError || "None"}

Return format STRICT:

BEFORE:
<code>

AFTER:
<fixed code (ONLY ONE main function)>

EXPLANATION:
- bullet points
- complexity + safety reasoning

COMPLEXITY_BEFORE:
O(...)

COMPLEXITY_AFTER:
O(...)

SAFETY_BEFORE:
X%

SAFETY_AFTER:
X%
`;

    const key = getCacheKey(code);

    if (cache.has(key)) return cache.get(key);

    try {
        const result = await Promise.race([
            groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: "You are a strict C code analyzer." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.2
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), 15000)
            )
        ]);

        const text = result?.choices?.[0]?.message?.content || null;

        cache.set(key, text);

        return text;

    } catch (err) {
        console.log("❌ GROQ ERROR:", err.message);

        const fallback = `
BEFORE:
${code}

AFTER:
${code}

EXPLANATION:
- AI unavailable (fallback mode)

COMPLEXITY_BEFORE:
O(?)

COMPLEXITY_AFTER:
O(?)

SAFETY_BEFORE:
100%

SAFETY_AFTER:
100%
`;

        cache.set(key, fallback);
        return fallback;
    }
}

/* ---------- EXTRACT ---------- */
function extractBlock(text, label) {
    if (!text) return "-";

    const regex = new RegExp(label + ":[\\s\\S]*?(?=\\n[A-Z_]+:|$)", "i");
    const match = text.match(regex);

    if (!match) return "-";

    return match[0]
        .replace(new RegExp(label + ":", "i"), "")
        .replace(/```[a-z]*|```/g, "")
        .trim();
}

/* ---------- CLEAN OLD FILES (IMPORTANT) ---------- */
setInterval(() => {
    fs.readdir(TEMP_DIR, (err, files) => {
        if (err) return;

        files.forEach(file => {
            const filePath = path.join(TEMP_DIR, file);

            fs.stat(filePath, (err, stat) => {
                if (err) return;

                if (Date.now() - stat.mtimeMs > 10 * 60 * 1000) {
                    fs.unlink(filePath, () => {});
                }
            });
        });
    });
}, 5 * 60 * 1000);

/* ---------- COMPILE (SAFE SPAWN) ---------- */
app.post('/compile', (req, res) => {

    let { code, language } = req.body;
    code = cleanCode(code);

    const id = Date.now() + Math.floor(Math.random() * 10000);

    const file = path.join(TEMP_DIR, `prog_${id}.${language === 'cpp' ? 'cpp' : 'c'}`);
    const exe = process.platform === "win32"
        ? path.join(TEMP_DIR, `prog_${id}.exe`)
        : path.join(TEMP_DIR, `prog_${id}`);

    fs.writeFileSync(file, code);

    const compiler = language === 'cpp' ? 'g++' : 'gcc';

    const compile = spawn(compiler, [
        '-Wall',
        '-Wextra',
        file,
        '-o',
        exe
    ]);

    let compileError = "";

    compile.stderr.on("data", d => compileError += d.toString());

    compile.on("close", (code) => {

        if (code !== 0) {
            return res.json({
                output: "",
                compileError,
                runtimeError: ""
            });
        }

        const child = spawn(exe, []);

        let output = "";
        let error = "";

        child.stdin.write("test\n");
        child.stdin.end();

        child.stdout.on("data", d => output += d.toString());
        child.stderr.on("data", d => error += d.toString());

        const timeout = setTimeout(() => {
            child.kill();
            return res.json({
                output,
                compileError,
                runtimeError: "Execution timeout"
            });
        }, 5000);

        child.on("close", (code, signal) => {

            clearTimeout(timeout);

            let runtimeMsg = "";

            if (signal === "SIGSEGV") runtimeMsg = "Segmentation Fault";
            else if (signal === "SIGFPE") runtimeMsg = "Division by zero";
            else if (code !== 0) runtimeMsg = `Runtime Error ${code}`;

            try {
                fs.unlinkSync(file);
                fs.unlinkSync(exe);
            } catch {}

            res.json({
                output: output.trim(),
                compileError,
                runtimeError: error || runtimeMsg
            });
        });
    });
});

/* ---------- ANALYZE ---------- */
app.post('/analyze', async (req, res) => {

    let { code, compileError, runtimeError } = req.body;

    code = cleanCode(code);

    const beforeComplexity = estimateComplexity(code);
    const beforeSafety = safetyScore(code);

    const aiText = await getAISuggestion(code, compileError, runtimeError);

    if (!aiText) {
        return res.json({
            before: code,
            after: code,
            explanation: "AI unavailable",
            complexity: `Before: ${beforeComplexity}\nAfter: ${beforeComplexity}`,
            safety: `Before: ${beforeSafety}\nAfter: ${beforeSafety}`
        });
    }

    const afterCode = extractBlock(aiText, "AFTER");

    res.json({
        before: extractBlock(aiText, "BEFORE") || code,
        after: afterCode,
        explanation: extractBlock(aiText, "EXPLANATION"),
        complexity: `Before: ${beforeComplexity}
After: ${estimateComplexity(afterCode)}`,
        safety: `Before: ${beforeSafety}
After: ${safetyScore(afterCode)}`
    });
});

/* ---------- START ---------- */
const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Production Compiler running on ${PORT}`);
});