const { withXcodeProject, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const MODULE_NAME = 'CinemaCameraProcessor';
const SOURCE_FILE = `${MODULE_NAME}.m`;

// Step 1: Copy .m into ios/ and register in pbxproj
function withNativeFiles(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const platformRoot = cfg.modRequest.platformProjectRoot;

    // Copy .m from plugins/ to ios/
    const srcM = path.join(__dirname, SOURCE_FILE);
    const dstM = path.join(platformRoot, SOURCE_FILE);
    fs.copyFileSync(srcM, dstM);

    // Register in pbxproj (root group, Sources build phase)
    const targetUuid = project.getFirstTarget().uuid;
    const rootGroupKey = project.getFirstProject().firstProject.mainGroup;

    const refs = project.pbxFileReferenceSection();
    const alreadyExists = Object.values(refs).some(
      (ref) => ref && ref.path && ref.path.replace(/"/g, '') === SOURCE_FILE
    );
    if (!alreadyExists) {
      project.addSourceFile(SOURCE_FILE, { target: targetUuid }, rootGroupKey);
    }

    return cfg;
  });
}

// Step 2: Patch bridging header and AppDelegate
function withBridgeRegistration(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const projectName = cfg.modRequest.projectName;

      // Patch bridging header — inline declaration, no file import
      const bridgingHeaderPath = path.join(platformRoot, projectName, `${projectName}-Bridging-Header.h`);
      if (fs.existsSync(bridgingHeaderPath)) {
        let content = fs.readFileSync(bridgingHeaderPath, 'utf8');
        const declaration = `\n#import <React/RCTBridgeModule.h>\n@interface CinemaCameraProcessor : NSObject <RCTBridgeModule>\n@end\n`;
        if (!content.includes('CinemaCameraProcessor')) {
          content += declaration;
          fs.writeFileSync(bridgingHeaderPath, content);
        }
      }

      // Patch AppDelegate.swift — register module in extraModules(for:)
      const appDelegatePath = path.join(platformRoot, projectName, 'AppDelegate.swift');
      if (fs.existsSync(appDelegatePath)) {
        let content = fs.readFileSync(appDelegatePath, 'utf8');
        const extraModules =
          `  override func extraModules(for bridge: RCTBridge) -> [RCTBridgeModule] {\n` +
          `    return [CinemaCameraProcessor()]\n` +
          `  }\n\n`;
        const marker = '  override func sourceURL(for bridge: RCTBridge)';
        if (!content.includes('extraModules(for bridge:') && content.includes(marker)) {
          content = content.replace(marker, extraModules + marker);
          fs.writeFileSync(appDelegatePath, content);
        }
      }

      return cfg;
    },
  ]);
}

module.exports = function withCinemaCameraProcessor(config) {
  config = withNativeFiles(config);
  config = withBridgeRegistration(config);
  return config;
};
