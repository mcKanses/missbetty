import fs from 'fs';
import path from 'path';

const EXAMPLE_CONFIG = `domain: myproject.localhost\nservices:\n  frontend:\n    port: 3000\n  backend:\n    port: 3000\n`;

const initCommand = () => {
  const configPath = path.resolve(process.cwd(), 'betty.yml');
  if (fs.existsSync(configPath)) {
    console.log('✔️  betty.yml existiert bereits.');
  } else {
    fs.writeFileSync(configPath, EXAMPLE_CONFIG, 'utf8');
    console.log('✅ Beispiel-betty.yml wurde erstellt!');
  }
  console.log('\nNächste Schritte:');
  console.log('  - Passe die betty.yml nach deinen Bedürfnissen an.');
  console.log('  - Starte den Proxy mit: node bin/betty.js proxy up');
  console.log('  - Starte dein Projekt mit: node bin/betty.js up');
}

export default initCommand
