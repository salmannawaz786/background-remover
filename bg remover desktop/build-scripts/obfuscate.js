const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

// Files to obfuscate (protect sensitive code)
const filesToObfuscate = [
    'auth.js',
    'auth-renderer.js',
    'renderer.js'
];

module.exports = async function(context) {
    const appOutDir = context.appOutDir;
    const resourcesPath = path.join(appOutDir, 'resources');
    const appPath = path.join(resourcesPath, 'app.asar.unpacked') || path.join(resourcesPath, 'app');
    
    console.log('🔐 Obfuscating sensitive files...');
    
    // Check if asar is unpacked
    if (!fs.existsSync(appPath)) {
        console.log('⚠️  App not unpacked, skipping obfuscation');
        return;
    }
    
    for (const fileName of filesToObfuscate) {
        const filePath = path.join(appPath, fileName);
        
        if (fs.existsSync(filePath)) {
            try {
                const code = fs.readFileSync(filePath, 'utf8');
                
                const obfuscationResult = JavaScriptObfuscator.obfuscate(code, {
                    compact: true,
                    controlFlowFlattening: true,
                    controlFlowFlatteningThreshold: 0.75,
                    deadCodeInjection: true,
                    deadCodeInjectionThreshold: 0.4,
                    debugProtection: false,
                    debugProtectionInterval: 0,
                    disableConsoleOutput: true,
                    identifierNamesGenerator: 'hexadecimal',
                    log: false,
                    numbersToExpressions: true,
                    renameGlobals: false,
                    selfDefending: true,
                    simplify: true,
                    splitStrings: true,
                    splitStringsChunkLength: 10,
                    stringArray: true,
                    stringArrayCallsTransform: true,
                    stringArrayEncoding: ['base64'],
                    stringArrayIndexShift: true,
                    stringArrayRotate: true,
                    stringArrayShuffle: true,
                    stringArrayWrappersCount: 2,
                    stringArrayWrappersChainedCalls: true,
                    stringArrayWrappersParametersMaxCount: 4,
                    stringArrayWrappersType: 'function',
                    stringArrayThreshold: 0.75,
                    transformObjectKeys: true,
                    unicodeEscapeSequence: false
                });
                
                fs.writeFileSync(filePath, obfuscationResult.getObfuscatedCode());
                console.log(`✅ Obfuscated: ${fileName}`);
            } catch (error) {
                console.error(`❌ Failed to obfuscate ${fileName}:`, error.message);
            }
        }
    }
    
    console.log('✅ Code obfuscation complete!');
};
