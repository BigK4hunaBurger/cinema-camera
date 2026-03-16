const fs = require('fs');
const path = require('path');

const podspecPath = path.join(__dirname, '../node_modules/ffmpeg-kit-react-native/ffmpeg-kit-react-native.podspec');

if (!fs.existsSync(podspecPath)) {
  console.log('ffmpeg-kit-react-native podspec not found, skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(podspecPath, 'utf8');
const original = "s.default_subspec   = 'https'";
const patched  = "s.default_subspec   = 'min'";

if (content.includes(patched)) {
  console.log('ffmpeg-kit-react-native podspec already patched');
  process.exit(0);
}

content = content.replace(original, patched);
fs.writeFileSync(podspecPath, content);
console.log('Patched ffmpeg-kit-react-native: https -> min');
