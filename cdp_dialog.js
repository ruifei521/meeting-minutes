const WebSocket = require('ws');

const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/96BD6A740ED210E5BBBEC806D6D426B3');

ws.on('open', function open() {
  console.log('Connected, checking for dialog...');
  
  // Get all inputs and dialog content
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { 
      expression: `
        (function() {
          let inputs = document.querySelectorAll('input');
          let textareas = document.querySelectorAll('textarea');
          let modals = document.querySelectorAll('[role="dialog"]');
          let results = 'Inputs: ';
          inputs.forEach(i => results += '[' + (i.name||i.id||i.placeholder) + '] ');
          results += ' | Textareas: ';
          textareas.forEach(t => results += '[' + (t.name||t.id||t.placeholder) + '] ';
          results += ' | Modals: ' + modals.length;
          // Also check for any visible modal or dialog
          let allDivs = document.querySelectorAll('div');
          let visibleModals = [];
          allDivs.forEach(d => {
            if (d.style.display === 'flex' || d.style.display === 'block') {
              if (d.textContent.includes('Database') || d.textContent.includes('name') || d.textContent.includes('Create')) {
                visibleModals.push(d.textContent.substring(0, 200));
              }
            }
          });
          results += ' | Visible content: ' + visibleModals.join(';; ');
          return results;
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