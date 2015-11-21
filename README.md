# Hello Extensions!

This post will describe the pieces needed to create a linter extension for Haskell for VS Code. It will build up the pieces one at a time and then connect them all together in the end. If you want to follow along, make sure you have followed the Prerequisites, otherwise skip down to Features.

## Prerequisites
- [VS Code (>= 0.10.1)][1]
- [Node][2]
- [Hlint][3] (added to your system's $PATH)
- Reading and understanding the official "Hello World!" [example][4] will help.
- Install the yeoman generator for VS Code, run it, and choose `New Extension (TypeScript)` (note: Spaces or special characters in your publisher name will lead to problems with publishing.)
```bash
npm install -g yo generator-code
yo code
```
- In the generated `src/` directory create a subdirectory called `features/` with a file called `hlintProvider.ts`.

# Features

This extension will use [hlint][3] to lint our haskell file. The output from hlint will allow us to mark parts of the code with what VS Code calls diagnostics. These provide the squiggly underlines, marks in the gutters, and tooltips on hover. We'll also leverage the suggestions from hlint to provide code actions to refactor our haskell code. These result in the lightbulbs that appear when you select an area that VS Code has underlined.

## Diagnostics + Diagnostic Collection
As described above, Diagnostics provide the underlines in the code. A `Diagnostic` object contains a range comprising the starting and ending line and column, a message, and a severity. To actually make them display, though, a `DiagnosticCollection` is needed.

Using `cp.spawn()`, extensions can call any executable and process the results. The code below uses `cp.spawn()` to call hlint, parses the output into `Diagnostic` objects, and then adds them to a `DiagnosticCollection` with `this.diagnosticCollection.set(textDocument.uri, diagnostics);` which add the chrome in the UI.

```js
// src/features/hlintProvider.ts
export default class HaskellLintingProvider {
	
	private diagnosticCollection: vscode.DiagnosticCollection;
	
	private doHlint(textDocument: vscode.TextDocument) {
		if (textDocument.languageId !== 'haskell') {
			return;
		}
		
		let decoded = ''
		let diagnostics: vscode.Diagnostic[] = [];

		let options = vscode.workspace.rootPath ? { cwd: vscode.workspace.rootPath } : undefined;
		let args =  ['--json', textDocument.fileName];
		
		let childProcess = cp.spawn('hlint', ['--json', textDocument.fileName], options);
		if (childProcess.pid) {
			childProcess.stdout.on('data', (data: Buffer) => {
				decoded += data;
			});
			childProcess.stdout.on('end', () => {
				JSON.parse(decoded).forEach( item => {
					let severity = item.severity.toLowerCase() === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
					let message = item.hint + " Replace: " + item.from + " ==> " + item.to;
					let range = new vscode.Range(item.startLine - 1, item.startColumn - 1, 
												 item.endLine - 1, item.endColumn - 1);
					let diagnostic = new vscode.Diagnostic(range, message, severity);
					diagnostics.push(diagnostic);
				});
				this.diagnosticCollection.set(textDocument.uri, diagnostics);
			});
		}
	}
	...
}
```

## Commands and CodeActionProviders
Actions that should appear in the command palette (ctrl+shift+p) are declared in `packages.json` as a `command`. The generated Hello World extension has an example of this. These can then be registered by an extension to trigger any function with the line `vscode.commands.registerCommand('extension.commandId', functionNameOrDefinition)`.

However, for an action that is context specific and shouldn't be in the command palette, don't register it in `packages.json`. But then how will it be triggered? That's where `CodeActionProviders` come in.

A `CodeActionProvider` makes the lightbulb show up in VS Code allowing users to perform refactorings, fix spelling mistakes, etc.

The `CodeActionProvider` interface defines a single method named `provideCodeActions()`. A class that implements this interface and registers with VS Code will have its `provideCodeActions()` method called whenever the user selects text or places the cursor in an area that contains a `Diagnostic`. It is up to the extension, then, to return an array of actions that are applicable for that `Diagnostic`.

The objects returned by `provideCodeActions()` are nothing more than references to a command as discussed above and an array of arguments to pass it. These will display as options if the user clicks the lightbulb. And when the user clicks on the lightbulb? The arguments are passed to whatever function the extension registered for that command as described above.

The code below illustrates how to add code actions to the `HaskellLintingProvider` shown above. `provideCodeActions()` receives the diagnostics as a member of `CodeActionContext` and returns an array with a single command. `runCodeAction()` is the function that we want to trigger if a user selects our action. Using the arguments passed along with the command it uses a `WorkspaceEdit` to fix a users code according to the suggestions of hlint.

```js
// src/features/hlintProvider.ts
export default class HaskellLintingProvider implements vscode.CodeActionProvider {
	...
	private static commandId: string = 'haskell.hlint.runCodeAction';
	
	public provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.Command[] {
		let diagnostic:vscode.Diagnostic = context.diagnostics[0];
		return [{
			title: "Accept hlint suggestion",
			command: HaskellLintingProvider.commandId,
			arguments: [document, diagnostic.range, diagnostic.message]
		}];
	}
	
	private runCodeAction(document: vscode.TextDocument, range: vscode.Range, message:string): any {
		let fromRegex:RegExp = /.*Replace:(.*)==>.*/g
		let fromMatch:RegExpExecArray = fromRegex.exec(message.replace(/\s/g, ''));
		let from = fromMatch[1];
		let to:string = document.getText(range).replace(/\s/g, '')
		if (from === to) {
			let newText = /.*==>\s(.*)/g.exec(message)[1]
			let edit = new vscode.WorkspaceEdit();
			edit.replace(document.uri, range, newText);
			return vscode.workspace.applyEdit(edit);
		} else {
			vscode.window.showErrorMessage("The suggestion was not applied because it is out of date. You might have tried to apply the same edit twice.");
		}
	}
```

## Wiring it all up
`HaskellLintingProvider` now contains functions that will perform the linting and set the diagnostics, return a list of code actions to make the lightbulb appear, and perform a code action if one is selected. Now it just needs the wiring to make it all work. `activate()` and `dispose()` deal with set-up and tear-down in VS Code extensions. The code below registers the command so that the `CodeActionProvider` can call it and sets up listeners to trigger the linting action.

```js
// src/features/hlintProvider.ts
export default class HaskellLintingProvider implements vscode.CodeActionProvider {
	...
	private command: vscode.Disposable;
	private static commandId: string = 'haskell.hlint.runCodeAction';
	private diagnosticCollection: vscode.DiagnosticCollection;
	
	public activate(subscriptions: vscode.Disposable[]) {
		this.command = vscode.commands.registerCommand(HaskellLintingProvider.commandId, this.runCodeAction, this);
		subscriptions.push(this);
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection();

		vscode.workspace.onDidOpenTextDocument(this.doHlint, this, subscriptions);
		vscode.workspace.onDidCloseTextDocument((textDocument)=> {
			this.diagnosticCollection.delete(textDocument.uri);
		}, null, subscriptions);

		vscode.workspace.onDidSaveTextDocument(this.doHlint, this);

		// Hlint all open haskell documents
		vscode.workspace.textDocuments.forEach(this.doHlint, this);
	}
	
	public dispose(): void {
		this.diagnosticCollection.clear();
		this.diagnosticCollection.dispose();
		this.command.dispose();
	}
	...
}
```

`HaskellLintingProvider` does the bulk of the work for this extension but it isn't the entry point. The real entry point to our extension is shown below from `src/extension.ts`. When the extension is activated by VS Code it activates its own helper to handle the linting and then registers that helper as a code action provider. 

```js
// src/extension.ts
import * as vscode from 'vscode'; 

import HaskellLintingProvider from './features/hlintProvider';

export function activate(context: vscode.ExtensionContext) {
	let linter = new HaskellLintingProvider();	
	linter.activate(context.subscriptions);
	vscode.languages.registerCodeActionsProvider('haskell', linter);
}
```

The last piece of the puzzle is declaring the extension in `package.json`. The `main` property declares the entry point of the extension where `activate()` should be called. `contributes` can be used to declare commands, but this extension uses it to declare haskell as a language. This is important, because the `activationEvents` property relies on VS Code recognizing haskell files.

```json
"main": "./out/src/extension",
"contributes": {
	"languages": [
		{
			"id": "haskell",
			"aliases": ["Haskell", "haskell"],
			"extensions": [".hs",".lhs"]
		}
	]
},
"activationEvents": [
	"onLanguage:haskell"
],
```

That's it! The source for the extension described here can be found [here][5]. I have also released a more sophisticated version of this linter in the [marketplace][6] and you can find the repo for that [here][7]. 

[1]: https://code.visualstudio.com
[2]: https://nodejs.org/en/download/
[3]: http://community.haskell.org/~ndm/hlint/
[4]: https://code.visualstudio.com/docs/extensions/example-hello-world
[5]: https://github.com/hoovercj/vscode-extension-tutorial
[6]: https://marketplace.visualstudio.com/items/hoovercj.haskell-linter
[7]: https://github.com/hoovercj/vscode-haskell-linter