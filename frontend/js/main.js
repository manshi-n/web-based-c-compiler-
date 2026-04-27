let editor;

// 1. Configure Monaco Loader
require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' } });

// 2. Initialize Editor
require(["vs/editor/editor.main"], function () {
    editor = monaco.editor.create(document.getElementById("editor"), {
        value: `#include <stdio.h>\n#include <string.h>\n\nint main() {\n    char name[10];\n    char copy[5];\n\n    gets(name);\n    strcpy(copy, name);\n\n    for(int i = 0; i <= 5; i++); {\n        printf("%s\\n", copy);\n    }\n\n    return 0;\n}`,
        language: "c",
        theme: "vs-dark",
        automaticLayout: true, // Fixes "disappearing" editor on resize
        fontSize: 14,
        minimap: { enabled: false }
    });
});

// 3. Error Highlighting Logic (GCC/G++ Parser)
function highlightErrors(errorText) {
    const model = editor.getModel();
    if (!errorText || errorText.includes("No errors") || errorText === "None") {
        monaco.editor.setModelMarkers(model, "owner", []);
        return;
    }

    let markers = [];
    const lines = errorText.split("\n");

    lines.forEach(line => {
        // Matches GCC format: filename:line:column:
        const match = line.match(/:(\d+):/); 
        if (match) {
            const lineNumber = parseInt(match[1]);
            markers.push({
                startLineNumber: lineNumber,
                endLineNumber: lineNumber,
                startColumn: 1,
                endColumn: model.getLineMaxColumn(lineNumber),
                message: line.trim(),
                severity: monaco.MarkerSeverity.Error
            });
        }
    });

    monaco.editor.setModelMarkers(model, "owner", markers);
}

// 4. Main Run & Analyze Function
document.getElementById("run-btn").addEventListener("click", async () => {
    const runBtn = document.getElementById("run-btn");
    const code = editor.getValue();
    const language = document.getElementById("lang-select")?.value || "c";
    const mode = document.getElementById("mode-select")?.value || "ai";
    
    // UI Feedback: Lock button and clear old data
    runBtn.disabled = true;
    runBtn.textContent = "Processing...";
    
    const fields = ['before', 'after', 'explanation', 'output', 'errors', 'complexity', 'safety'];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "...";
    });

    try {
        /* ---------- 1. COMPILE & RUN ---------- */
        const compResponse = await fetch("http://localhost:5000/compile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, language })
        });

        const compData = await compResponse.json();
        
        // Update basic output and errors
        document.getElementById("output").textContent = compData.output || "No output";
        const errorLog = compData.compileError || compData.runtimeError || "None";
        document.getElementById("errors").textContent = errorLog;

        // Apply Red Underlines if errors exist
        highlightErrors(errorLog);

        /* ---------- 2. AI ANALYSIS ---------- */
        const anaResponse = await fetch("http://localhost:5000/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                code, 
                mode,
                compileError: compData.compileError,
                runtimeError: compData.runtimeError 
            })
        });

        const data = await anaResponse.json();

        // Populate the locked sidebar sections
        document.getElementById("before").textContent = data.before || code;
        document.getElementById("after").textContent = data.after || "-";
        document.getElementById("explanation").textContent = data.explanation || "-";
        document.getElementById("complexity").textContent = data.complexity || "-";
        document.getElementById("safety").textContent = data.safety || "-";

    } catch (err) {
        console.error("Connection Error:", err);
        document.getElementById("errors").textContent = "❌ Server error: Check if backend is running.";
    } finally {
        runBtn.disabled = false;
        runBtn.textContent = "▶ Run & Analyze";
    }
});