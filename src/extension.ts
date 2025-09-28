import * as vscode from "vscode";
import axios from "axios";
import GITHUB_URLS from "./config";

async function fuzzySearch() {
    const qp = vscode.window.createQuickPick<vscode.QuickPickItem>();
    qp.title = "JASS API Search";
    qp.placeholder = "Type to search";
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;

    qp.busy = true;
    qp.items = [{ label: "Loading...", description: "Fetching documentation", detail: "N/A" }];
    qp.show();

    const Fuse = (await import("fuse.js")).default;

    // fetch + parse in the background
    let apiData: { name: string; signature: string; description: string }[] = [];
    try {
        const responses = await Promise.all(GITHUB_URLS.map((url) => axios.get(url)));
        const texts = responses.map((r) => r.data as string);

        apiData = (function parseApiDocumentation(texts: string[]) {
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
        })(texts);
    } catch (err) {
        qp.busy = false;
        qp.items = [{ label: "Failed to fetch api data", description: "Check network / urls", detail: String(err) }];
        return; // leave quickpick up so user can read the error
    }

    if (apiData.length === 0) {
        qp.busy = false;
        qp.items = [{ label: "No functions found", description: "Api docs are empty" }];
        return;
    }

    // build fuse index
    const fuse = new Fuse(apiData, {
        keys: ["name", "signature", "description"],
        threshold: 0.3,
        ignoreLocation: true,
        includeScore: true,
        minMatchCharLength: 2,
    });

    // convert current dataset -> quickpick items
    const toItems = (rows: typeof apiData): vscode.QuickPickItem[] =>
        rows.slice(0, 200).map((r) => ({
            label: r.name,
            description: r.signature,
            detail: undefined,
        }));

    // show everything before typing
    qp.busy = false;
    qp.items = toItems(apiData);

    // live filtering as user types
    qp.onDidChangeValue((value) => {
        if (!value.trim()) {
            qp.items = toItems(apiData);
            return;
        }
        const results = fuse.search(value).map((r) => r.item);
        qp.items = results.length ? toItems(results) : [{ label: "no matches", description: "try different terms" }];
    });

    // open details on selection
    qp.onDidChangeSelection((sel) => {
        const picked = sel?.[0];
        if (!picked) return;
        const chosen = apiData.find((r) => r.name === picked.label);
        if (chosen) showFunctionDetails(chosen);
        qp.hide();
    });

    qp.onDidHide(() => qp.dispose());
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

    // Highlight function name and types
    const highlightedSignature = func.signature
        .replace(/^(\w+)\(/, `<span class="func-name">$1</span>(`) // Color function name
        .replace(/\b(integer|real|boolean|string|unit|player|force|nothing)\b/g, `<span class="type">$1</span>`); // Color types

    const highlightedDescription = func.description
        .split("\n")
        .map(line => line.replace(/\s+$/, "")) // Remove trailing whitespace
        .filter(line => !line.startsWith("/**") && !line.startsWith("*/")) // Remove /** and */
        .map(line => line.replace(/(@\w+)/g, `<span class="annotation">$1</span>`)) // Highlight @annotations
        .join("\n");

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
                    padding: 10px;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    font-size: 14px;
                    max-width: 100%;
                    word-wrap: break-word;
                    white-space: pre-wrap;
                    box-sizing: border-box;
                }
                h2 {
                    color: var(--vscode-editor-foreground);
                    font-size: 20px;
                    margin: 0;
                    padding: 10px;
                }
                .func-name {
                    color: #c678dd;
                    font-weight: bold;
                }
                .type {
                    color: #98c379;
                    font-weight: bold;
                }
                .annotation {
                    color: #61afef;
                    font-weight: bold;
                }
                code {
                    font-size: 16px;
                    display: inline-block;
                }
                p {
                    font-size: 16px;
                    line-height: 1.4;
                }
            </style>
        </head>
        <body>
            <code>${highlightedSignature}</code>
            <h2>Description</h2>
            <p>${highlightedDescription}</p>
        </body>
        </html>
    `;
}

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand("jass-api-search.search", fuzzySearch);
    context.subscriptions.push(disposable);
}

export function deactivate() {}
