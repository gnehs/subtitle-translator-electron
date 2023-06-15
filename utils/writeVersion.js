const { version } = require('../package.json');
const fs = require('fs');
const path = require('path');
let useVersion = fs.readFileSync(path.resolve(__dirname, '../src/hooks/useVersion.ts'), 'utf8')
useVersion = useVersion.replace("0.0.0", version)
fs.writeFileSync(path.resolve(__dirname, '../src/hooks/useVersion.ts'), useVersion, 'utf8')