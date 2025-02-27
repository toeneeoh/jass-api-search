import * as vscode from "vscode";
import axios from "axios";

async function fuzzySearch() {
    const Fuse = (await import("fuse.js")).default;

    const GITHUB_FILES = [
        "https://raw.githubusercontent.com/lep/jassdoc/master/Blizzard.j",
        "https://raw.githubusercontent.com/lep/jassdoc/master/common.j",
        "https://raw.githubusercontent.com/lep/jassdoc/master/common.ai",
    ];

    /**
     * Fetches all API documentation files from GitHub.
     */
    async function fetchApiDocumentation(): Promise<string[]> {
        try {
            const responses = await Promise.all(GITHUB_FILES.map((url) => axios.get(url)));
            return responses.map((res) => res.data);
        } catch (error) {
            vscode.window.showErrorMessage("Failed to fetch API data from GitHub.");
            return [];
        }
    }

    /**
     * Extracts function signatures and comments from the API documentation.
     */
    function parseApiDocumentation(texts: string[]): { name: string; signature: string; description: string }[] {
        const combinedText = texts.join("\n");
        const matches = combinedText.match(/\/\*\*[\s\S]*?\*\/\s*\nnative\s+(\w+)\s+takes\s+([\s\S]*?)\s+returns\s+(\w+)/g);

        if (!matches) return [];

        return matches.map((match) => {
            const name = match.match(/native\s+(\w+)/)?.[1] || "Unknown Function";
            const parameters = match.match(/takes\s+([\s\S]*?)\s+returns/)?.[1]?.trim() || "nothing";
            const returnType = match.match(/returns\s+(\w+)/)?.[1] || "nothing";

            return {
                name,
                signature: `${name}(${parameters}): ${returnType}`,
                description: match,
            };
        });
    }

    const apiTexts = await fetchApiDocumentation();
    if (apiTexts.length === 0) return;

    const apiData = parseApiDocumentation(apiTexts);
    if (apiData.length === 0) {
        vscode.window.showInformationMessage("No functions found.");
        return;
    }

    const fuse = new Fuse(apiData, { keys: ["name", "signature", "description"], threshold: 0.3 });

    const userInput = await vscode.window.showInputBox({ placeHolder: "Search API..." });
    if (!userInput) return;

    const results = fuse.search(userInput).map((res) => res.item);

    if (results.length === 0) {
        vscode.window.showInformationMessage("No matching functions found.");
        return;
    }

    const selection = await vscode.window.showQuickPick(
        results.map((res) => `${res.name}: ${res.signature}`),
        { placeHolder: "Select a function" }
    );

    if (selection) {
        const selectedItem = results.find((res) => selection.startsWith(res.name));
        if (selectedItem) {
            showFunctionDetails(selectedItem);
        }
    }
}

/**
 * Displays full function details in a VSCode webview panel.
 */
function showFunctionDetails(func: { name: string; signature: string; description: string }) {
    const panel = vscode.window.createWebviewPanel(
        "functionDetails",
        `${func.name}`,
        vscode.ViewColumn.Beside,
        { enableScripts: false }
    );

    panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${func.name}</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 20px;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                pre {
                    background: var(--vscode-editorWidget-background);
                    padding: 10px;
                    border-radius: 5px;
                    overflow-x: auto;
                    color: var(--vscode-editor-foreground);
                }
                h2, h3 {
                    color: var(--vscode-editor-foreground);
                }
            </style>
        </head>
        <body>
            <h2>${func.name}</h2>
            <pre><code>${func.signature}</code></pre>
            <h3>Description</h3>
            <pre>${func.description}</pre>
        </body>
        </html>
    `;
}

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand("jass-api-search.search", fuzzySearch);
    context.subscriptions.push(disposable);
}

export function deactivate() {}
