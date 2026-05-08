const WebSocket = require('ws');

const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/96BD6A740ED210E5BBBEC806D6D426B3');

ws.on('open', function open() {
  console.log('Connected, clicking Create Database...');
  
  // Click the Create Database button
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { 
      expression: `
        (function() {
          let buttons = document.querySelectorAll('button');
          for (let b of buttons) {
            if (b.textContent.trim().includes('Create Database')) {
              b.click();
              return 'Clicked!';
            }
          }
          return 'Button not found';
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