const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Unsafe function table
const unsafeFunctions = [
    { name: "gets", safe: "fgets", explanation: "Use fgets(buffer, size, stdin) to avoid buffer overflow." },
    { name: "strcpy", safe: "strncpy", explanation: "Use strncpy to prevent buffer overflow." },
    { name: "strcat", safe: "strncat", explanation: "Use strncat for safe string concatenation." },
    { name: "scanf", safe: "fgets or scanf with length", explanation: "Always use length specifiers to avoid overflow." },
    { name: "sprintf", safe: "snprintf", explanation: "Use snprintf for safe formatting." }
];

// Compile C/C++ code
app.post('/compile', (req, res) => {
    const { code, language } = req.body;
    const ext = language === 'cpp' ? 'cpp' : 'c';
    const filename = path.join(TEMP_DIR, `prog.${ext}`);
    const outputExe = path.join(TEMP_DIR, 'prog.out');

    fs.writeFileSync(filename, code);

    // Compile command
    const cmd = language === 'cpp'
        ? `g++ "${filename}" -o "${outputExe}" -Wall`
        : `gcc "${filename}" -o "${outputExe}" -Wall`;

    exec(cmd, (err, stdout, stderr) => {
        if (err) {
            return res.json({ output: '', errors: stderr, analysis: '', complexity: '', suggestions: '' });
        }

        // Run compiled program
        exec(`"${outputExe}"`, { timeout: 3000 }, (runErr, runStdout, runStderr) => {
            return res.json({
                output: runStdout,
                errors: runStderr,
                analysis: '',
                complexity: '',
                suggestions: ''
            });
        });
    });
});

// Code analysis endpoint (Beginner/Advanced mode)
app.post('/analyze', (req, res) => {
    const { code, mode } = req.body;

    let analysis = "";
    let suggestions = "";
    let complexity = "-";

    if(mode === "beginner") {
        // Check unsafe functions
        unsafeFunctions.forEach(f => {
            const regex = new RegExp(`\\b${f.name}\\s*\\(`, "g");
            if(regex.test(code)){
                analysis += `⚠️ Unsafe function "${f.name}" detected. Safe alternative: "${f.safe}". ${f.explanation}\n`;
            }
        });

        // Beginner suggestions
        suggestions = "- Use descriptive variable names\n";
        suggestions += "- Modularize your code into functions\n";
        suggestions += "- Avoid unsafe functions (see analysis above)\n";
        suggestions += "- Prefer safe memory handling\n";

        // Simple complexity estimation
        if(/for|while|do/.test(code)) complexity = "O(n) loop(s) detected";
        else complexity = "O(1)";

        analysis = "🧠 Beginner Analysis:\n" + analysis + "This shows unsafe functions and how to improve your code.";

    } else {
        // Advanced mode
        analysis = "🧠 Advanced Analysis:\n- Focus on logic correctness and efficiency.\n- Unsafe functions are not highlighted.";
        suggestions = "";
        complexity = "Complexity estimation is general in advanced mode.";
    }

    res.json({ analysis, suggestions, complexity });
});

app.listen(5000, () => {
    console.log('Backend running on http://localhost:5000');
});