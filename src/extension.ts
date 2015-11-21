import * as vscode from 'vscode'; 

import HaskellLintingProvider from './features/hlintProvider';

export function activate(context: vscode.ExtensionContext) {
	let linter = new HaskellLintingProvider();	
	linter.activate(context.subscriptions);
	vscode.languages.registerCodeActionsProvider('haskell', linter);
}