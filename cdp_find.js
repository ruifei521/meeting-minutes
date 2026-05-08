const WebSocket = require('ws');

// Connect to the Upstash page
const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/96BD6A740ED210E5BBBEC806D6D426B3');

ws.on('open', function open() {
  console.log('Connected to Upstash page');
  
  // Get page content to find Create Database button
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { 
      expression: `
        (function() {
          // Find all buttons and links related to creating database
          let buttons = document.querySelectorAll('button');
          let links = document.querySelectorAll('a');
          let result = 'Buttons: ';
          buttons.forEach(b => {
            if (b.textContent.toLowerCase().includes('create') || 
                b.textContent.toLowerCase().includes('new') ||
                b.textContent.toLowerCase().includes('database')) {
              result += '[' + b.textContent.trim() + '] ';
            }
          });
          result += ' | Links: ';
          links.forEach(l => {
            if (l.textContent.toLowerCase().includes('create') || 
                l.textContent.toLowerCase().includes('new') ||
                l.textContent.toLowerCase().includes('database')) {
              result += '[' + l.textContent.trim() + '] ';
            }
          });
          return result;
        })()
      `
    }
  }));
});

ws.on('message', function incoming(data) {
  const msg = JSON.parse(data);
  if (msg.result && msg.result.result && msg.result.result.value) {
    console.log('Result:', msg.result.result.value);
  }
});

setTimeout(() => {
  ws.close();
  process.exit(0);
}, 5000);