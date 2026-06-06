const fs = require('fs');
const path = require('path');

const output = [];
const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
  output.push(args.map(a => String(a)).join(' '));
  originalLog.apply(console, args);
};

console.error = (...args) => {
  output.push('ERROR: ' + args.map(a => String(a)).join(' '));
  originalError.apply(console, args);
};

try {
  require('./tests/test-deadline-sla.js');
} catch (e) {
  output.push('FATAL ERROR: ' + e.message + '\n' + e.stack);
  originalError(e);
}

process.on('exit', (code) => {
  output.push('EXIT CODE: ' + code);
  fs.writeFileSync(
    path.join(__dirname, 'test_results.txt'),
    output.join('\n'),
    'utf8'
  );
});
