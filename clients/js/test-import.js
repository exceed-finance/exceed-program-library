// This is a simple test file to check if we can import the package
try {
    process.stdout.write('Attempting to import the package...\n');
    const importedModule = require('./dist/index.js');
    process.stdout.write('Import successful!\n');
    process.stdout.write('Module contents: ' + JSON.stringify(Object.keys(importedModule)) + '\n');

    const { EarlyPurchase, LiquidStaking } = importedModule;
    process.stdout.write('EarlyPurchase: ' + (EarlyPurchase ? 'Imported successfully' : 'Import failed') + '\n');
    process.stdout.write('LiquidStaking: ' + (LiquidStaking ? 'Imported successfully' : 'Import failed') + '\n');
} catch (error) {
    process.stderr.write('Error importing the package: ' + error.stack + '\n');
}
